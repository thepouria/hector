import { Injectable } from '@nestjs/common';
import {
  PartyContactPointStatus,
  PartyContactPointType,
  PartyRoleStatus,
  PartyRoleType,
  PartyStatus,
  PartyType,
  Prisma,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import { allocatePartySequence, formatPartyCode } from './party-numbering';
import { PARTY_ERROR_MESSAGES } from './party.constants';
import {
  normalizeContactValue,
  normalizeEmailForLookup,
  normalizePhoneForLookup,
  resolveDisplayName,
} from './party.normalization';

export type StrongIdentityLookup = {
  nationalId?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
};

export type ContactIdentityLookup = {
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type PartyMatchView = {
  partyId: string;
  partyCode: string;
  displayName: string;
  type: PartyType;
  status: PartyStatus;
  matchedOn: Array<'nationalId' | 'registrationNumber' | 'taxId' | 'mobile' | 'phone' | 'email'>;
  roles: PartyRoleType[];
};

type Tx = Prisma.TransactionClient;

/**
 * Canonical Party identity lookup + domain linking helpers (Phase 5.5.2).
 * Domain services must NOT implement their own matching.
 */
@Injectable()
export class PartyIdentityLookupService {
  constructor(private readonly database: DatabaseService) {}

  async findPartyByStrongIdentity(
    company: CompanyContext,
    type: PartyType,
    identity: StrongIdentityLookup,
  ): Promise<PartyMatchView | null> {
    const matches = await this.findPotentialPartyMatches(company, {
      type,
      ...identity,
    });
    const strong = matches.filter((m) =>
      m.matchedOn.some((x) => x === 'nationalId' || x === 'registrationNumber' || x === 'taxId'),
    );
    return strong.length === 1 ? strong[0]! : null;
  }

  async findPotentialPartyMatches(
    company: CompanyContext,
    input: StrongIdentityLookup &
      ContactIdentityLookup & {
        type?: PartyType;
        excludePartyId?: string;
      },
  ): Promise<PartyMatchView[]> {
    const map = new Map<string, PartyMatchView>();

    const add = async (
      partyId: string,
      reason: PartyMatchView['matchedOn'][number],
    ) => {
      if (input.excludePartyId && partyId === input.excludePartyId) return;
      const existing = map.get(partyId);
      if (existing) {
        if (!existing.matchedOn.includes(reason)) existing.matchedOn.push(reason);
        return;
      }
      const party = await this.database.client.party.findFirst({
        where: {
          id: partyId,
          companyId: company.companyId,
          ...(input.type ? { type: input.type } : {}),
        },
        include: {
          roles: { where: { status: PartyRoleStatus.ACTIVE }, select: { roleType: true } },
        },
      });
      if (!party) return;
      map.set(partyId, {
        partyId: party.id,
        partyCode: party.partyCode,
        displayName: party.displayName,
        type: party.type,
        status: party.status,
        matchedOn: [reason],
        roles: party.roles.map((r) => r.roleType),
      });
    };

    if (input.nationalId?.trim()) {
      const rows = await this.database.client.party.findMany({
        where: {
          companyId: company.companyId,
          nationalId: input.nationalId.trim(),
          ...(input.type ? { type: input.type } : {}),
        },
        select: { id: true },
      });
      for (const r of rows) await add(r.id, 'nationalId');
    }
    if (input.registrationNumber?.trim()) {
      const rows = await this.database.client.party.findMany({
        where: {
          companyId: company.companyId,
          registrationNumber: input.registrationNumber.trim(),
          ...(input.type ? { type: input.type } : {}),
        },
        select: { id: true },
      });
      for (const r of rows) await add(r.id, 'registrationNumber');
    }
    if (input.taxId?.trim()) {
      const rows = await this.database.client.party.findMany({
        where: {
          companyId: company.companyId,
          taxId: input.taxId.trim(),
          ...(input.type ? { type: input.type } : {}),
        },
        select: { id: true },
      });
      for (const r of rows) await add(r.id, 'taxId');
    }

    const contactQueries: Array<{
      type: PartyContactPointType;
      normalizedValue: string;
      reason: PartyMatchView['matchedOn'][number];
    }> = [];
    if (input.mobile?.trim()) {
      contactQueries.push({
        type: PartyContactPointType.MOBILE,
        normalizedValue: normalizePhoneForLookup(input.mobile),
        reason: 'mobile',
      });
    }
    if (input.phone?.trim()) {
      const n = normalizePhoneForLookup(input.phone);
      contactQueries.push({ type: PartyContactPointType.PHONE, normalizedValue: n, reason: 'phone' });
      contactQueries.push({ type: PartyContactPointType.MOBILE, normalizedValue: n, reason: 'phone' });
    }
    if (input.email?.trim()) {
      contactQueries.push({
        type: PartyContactPointType.EMAIL,
        normalizedValue: normalizeEmailForLookup(input.email),
        reason: 'email',
      });
    }
    if (contactQueries.length > 0) {
      const hits = await this.database.client.partyContactPoint.findMany({
        where: {
          companyId: company.companyId,
          status: PartyContactPointStatus.ACTIVE,
          OR: contactQueries.map((q) => ({
            type: q.type,
            normalizedValue: q.normalizedValue,
          })),
          ...(input.type
            ? { party: { companyId: company.companyId, type: input.type } }
            : {}),
        },
        select: { partyId: true, type: true, normalizedValue: true },
      });
      for (const hit of hits) {
        const reason =
          contactQueries.find(
            (q) => q.type === hit.type && q.normalizedValue === hit.normalizedValue,
          )?.reason ?? 'mobile';
        await add(hit.partyId, reason);
      }
    }

    return [...map.values()];
  }

  async requireCompanyParty(
    tx: Tx,
    companyId: string,
    partyId: string,
  ): Promise<{
    id: string;
    companyId: string;
    displayName: string;
    legalName: string | null;
    status: PartyStatus;
    type: PartyType;
    nationalId: string | null;
    firstName: string | null;
    lastName: string | null;
    tradeName: string | null;
  }> {
    const party = await tx.party.findFirst({
      where: { id: partyId, companyId },
    });
    if (!party) {
      throw AppError.notFound(PARTY_ERROR_MESSAGES.NOT_FOUND);
    }
    if (party.status === PartyStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message: PARTY_ERROR_MESSAGES.ARCHIVED_IMMUTABLE,
        statusCode: 409,
      });
    }
    return party;
  }

  async ensureActiveRole(
    tx: Tx,
    companyId: string,
    partyId: string,
    roleType: PartyRoleType,
  ): Promise<void> {
    const existing = await tx.partyRole.findFirst({
      where: { companyId, partyId, roleType },
    });
    if (existing) {
      if (existing.status !== PartyRoleStatus.ACTIVE) {
        await tx.partyRole.update({
          where: { id: existing.id },
          data: { status: PartyRoleStatus.ACTIVE, endedAt: null },
        });
      }
      return;
    }
    await tx.partyRole.create({
      data: { companyId, partyId, roleType, status: PartyRoleStatus.ACTIVE },
    });
  }

  async createPartyWithRole(
    tx: Tx,
    companyId: string,
    input: {
      type: PartyType;
      displayName?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      legalName?: string | null;
      tradeName?: string | null;
      nationalId?: string | null;
      registrationNumber?: string | null;
      taxId?: string | null;
      mobile?: string | null;
      phone?: string | null;
      email?: string | null;
      addressLine?: string | null;
      roleType: PartyRoleType;
      createdById?: string | null;
    },
  ): Promise<{ id: string; displayName: string }> {
    // Strong identity conflict → reject (do not silent-create duplicate).
    const strong = await this.findStrongInTx(tx, companyId, input.type, {
      nationalId: input.nationalId,
      registrationNumber: input.registrationNumber,
      taxId: input.taxId,
    });
    if (strong) {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message: PARTY_ERROR_MESSAGES.NATIONAL_ID_CONFLICT,
        statusCode: 409,
        details: {
          existingPartyId: strong.id,
          existingPartyCode: strong.partyCode,
          displayName: strong.displayName,
        },
      });
    }

    const displayName = resolveDisplayName({
      type: input.type,
      displayName: input.displayName,
      firstName: input.firstName,
      lastName: input.lastName,
      legalName: input.legalName,
      tradeName: input.tradeName,
    });

    const seq = await allocatePartySequence(tx, companyId);
    let partyCode = formatPartyCode(seq);
    // Guard against sequence drift after re-seed / partial migrations.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const collision = await tx.party.findFirst({
        where: { companyId, partyCode },
        select: { id: true },
      });
      if (!collision) break;
      const next = await allocatePartySequence(tx, companyId);
      partyCode = formatPartyCode(next);
    }

    const party = await tx.party.create({
      data: {
        companyId,
        partyCode,
        type: input.type,
        status: PartyStatus.ACTIVE,
        displayName,
        firstName: input.type === PartyType.INDIVIDUAL ? (input.firstName ?? null) : null,
        lastName: input.type === PartyType.INDIVIDUAL ? (input.lastName ?? null) : null,
        legalName: input.type === PartyType.ORGANIZATION ? (input.legalName ?? null) : null,
        tradeName: input.type === PartyType.ORGANIZATION ? (input.tradeName ?? null) : null,
        nationalId: input.nationalId?.trim() || null,
        registrationNumber: input.registrationNumber?.trim() || null,
        taxId: input.taxId?.trim() || null,
        createdById: input.createdById ?? null,
      },
    });

    await this.ensureActiveRole(tx, companyId, party.id, input.roleType);

    if (input.mobile?.trim()) {
      const { value, normalizedValue } = normalizeContactValue(
        PartyContactPointType.MOBILE,
        input.mobile,
      );
      await tx.partyContactPoint.create({
        data: {
          companyId,
          partyId: party.id,
          type: PartyContactPointType.MOBILE,
          value,
          normalizedValue,
          isPrimary: true,
          status: PartyContactPointStatus.ACTIVE,
        },
      });
    }
    if (input.phone?.trim()) {
      const { value, normalizedValue } = normalizeContactValue(
        PartyContactPointType.PHONE,
        input.phone,
      );
      await tx.partyContactPoint.create({
        data: {
          companyId,
          partyId: party.id,
          type: PartyContactPointType.PHONE,
          value,
          normalizedValue,
          isPrimary: !input.mobile?.trim(),
          status: PartyContactPointStatus.ACTIVE,
        },
      });
    }
    if (input.email?.trim()) {
      const { value, normalizedValue } = normalizeContactValue(
        PartyContactPointType.EMAIL,
        input.email,
      );
      await tx.partyContactPoint.create({
        data: {
          companyId,
          partyId: party.id,
          type: PartyContactPointType.EMAIL,
          value,
          normalizedValue,
          isPrimary: !input.mobile?.trim() && !input.phone?.trim(),
          status: PartyContactPointStatus.ACTIVE,
        },
      });
    }

    return { id: party.id, displayName: party.displayName };
  }

  private async findStrongInTx(
    tx: Tx,
    companyId: string,
    type: PartyType,
    identity: StrongIdentityLookup,
  ): Promise<{ id: string; partyCode: string; displayName: string } | null> {
    const or: Prisma.PartyWhereInput[] = [];
    if (identity.nationalId?.trim()) or.push({ nationalId: identity.nationalId.trim() });
    if (identity.registrationNumber?.trim())
      or.push({ registrationNumber: identity.registrationNumber.trim() });
    if (identity.taxId?.trim()) or.push({ taxId: identity.taxId.trim() });
    if (or.length === 0) return null;
    const rows = await tx.party.findMany({
      where: { companyId, type, OR: or },
      take: 2,
    });
    return rows.length === 1
      ? { id: rows[0]!.id, partyCode: rows[0]!.partyCode, displayName: rows[0]!.displayName }
      : rows[0]
        ? { id: rows[0].id, partyCode: rows[0].partyCode, displayName: rows[0].displayName }
        : null;
  }
}
