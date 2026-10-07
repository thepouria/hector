import { Injectable } from '@nestjs/common';
import {
  CustomerStatus,
  LoanStatus,
  PartyAddressType,
  PartyContactPointStatus,
  PartyContactPointType,
  PartyRelationshipStatus,
  PartyRoleStatus,
  PartyRoleType,
  PartyStatus,
  PartyType,
  PartnerStatus,
  PERMISSIONS,
  type PermissionKey,
  Prisma,
  PurchaseOrderStatus,
  PurchasingLifecycleStatus,
  SalesOrderStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { getRequestContext } from '../../common/context/request-context';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import type { CompanyContext } from '../companies/types/company.types';
import type { AddPartyRoleDto } from './dto/add-party-role.dto';
import type { CreatePartyDto } from './dto/create-party.dto';
import type { PartyDuplicateCheckDto } from './dto/duplicate-check.dto';
import type { ListPartiesQueryDto } from './dto/list-parties.query.dto';
import type { CreatePartyAddressDto, UpdatePartyAddressDto } from './dto/party-address.dto';
import type { CreatePartyContactDto, UpdatePartyContactDto } from './dto/party-contact.dto';
import type { UpdatePartyDto } from './dto/update-party.dto';
import { allocatePartySequence, formatPartyCode } from './party-numbering';
import { PARTY_ERROR_MESSAGES } from './party.constants';
import {
  assertAddressGeo,
  assertAddressLabel,
  assertAddressLine1,
  assertAddressNotes,
  assertAddressOptionalLine,
  assertAddressPostal,
  assertAddressRecipient,
  assertContactLabel,
  assertIdField,
  assertLegalName,
  assertNotes,
  assertPersonName,
  assertTradeName,
  mapPartyUniqueViolation,
  normalizeContactValue,
  normalizeSearchQuery,
  resolveDisplayName,
} from './party.normalization';

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

const OPEN_LOAN_STATUSES: LoanStatus[] = [
  LoanStatus.DRAFT,
  LoanStatus.ACTIVE,
  LoanStatus.PARTIALLY_REPAID,
];

type PartyRow = {
  id: string;
  companyId: string;
  partyCode: string;
  type: PartyType;
  status: PartyStatus;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: Date | null;
  legalName: string | null;
  tradeName: string | null;
  nationalId: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  createdById: string | null;
  updatedById: string | null;
};

type ContactRow = {
  id: string;
  companyId: string;
  partyId: string;
  type: PartyContactPointType;
  value: string;
  normalizedValue: string;
  label: string | null;
  isPrimary: boolean;
  status: PartyContactPointStatus;
  createdAt: Date;
  updatedAt: Date;
};

type AddressRow = {
  id: string;
  companyId: string;
  partyId: string;
  label: string | null;
  type: PartyAddressType;
  country: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  addressLine1: string;
  addressLine2: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

type RoleRow = {
  id: string;
  companyId: string;
  partyId: string;
  roleType: PartyRoleType;
  status: PartyRoleStatus;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PartyView = {
  id: string;
  companyId: string;
  partyCode: string;
  type: PartyType;
  status: PartyStatus;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  legalName: string | null;
  tradeName: string | null;
  nationalId: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type PartyContactView = {
  id: string;
  companyId: string;
  partyId: string;
  type: PartyContactPointType;
  value: string;
  label: string | null;
  isPrimary: boolean;
  status: PartyContactPointStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type PartyAddressView = {
  id: string;
  companyId: string;
  partyId: string;
  label: string | null;
  type: PartyAddressType;
  country: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  addressLine1: string;
  addressLine2: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type PartyRoleView = {
  id: string;
  companyId: string;
  partyId: string;
  roleType: PartyRoleType;
  status: PartyRoleStatus;
  startedAt: Date;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PartyDetailView = PartyView & {
  contacts: PartyContactView[];
  addresses: PartyAddressView[];
  roles: PartyRoleView[];
};

export type PartyListItemView = PartyView & {
  primaryMobile: string | null;
  primaryEmail: string | null;
  roles: PartyRoleType[];
};

export type DuplicateMatchStrength = 'EXACT' | 'STRONG' | 'POTENTIAL';

export type PotentialDuplicateMatch = {
  partyId: string;
  partyCode: string;
  displayName: string;
  type: PartyType;
  status: PartyStatus;
  matchStrength: DuplicateMatchStrength;
  matchedOn: Array<'nationalId' | 'registrationNumber' | 'mobile' | 'email' | 'phone'>;
  reasonCodes: Array<
    | 'NATIONAL_ID_MATCH'
    | 'REGISTRATION_NUMBER_MATCH'
    | 'MOBILE_MATCH'
    | 'EMAIL_MATCH'
    | 'PHONE_MATCH'
  >;
  roles: PartyRoleType[];
};

export type PartyRelatedEntitiesView = {
  supplier: {
    id: string;
    code: string | null;
    status: string;
    openPurchaseOrderCount: number;
  } | null;
  customer: {
    id: string;
    code: string | null;
    status: string;
    openSalesOrderCount: number;
  } | null;
  partner: {
    id: string;
    status: string;
  } | null;
  loansAsLender: Array<{
    id: string;
    number: string;
    currency: string;
    status: string;
    contractedPrincipal: string;
  }>;
  loansAsBorrower: Array<{
    id: string;
    number: string;
    currency: string;
    status: string;
    contractedPrincipal: string;
  }>;
  capitalContributions: Array<{
    id: string;
    number: string;
    currency: string;
    status: string;
    amount: string;
  }>;
  contactRelationships: Array<{
    relationshipId: string;
    direction: 'FROM' | 'TO';
    relatedPartyId: string;
    relatedPartyCode: string;
    relatedDisplayName: string;
    type: string;
    status: string;
  }>;
  omitted: {
    purchasing: boolean;
    sales: boolean;
    finance: boolean;
  };
};

@Injectable()
export class PartiesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
  ) {}

  async list(
    company: CompanyContext,
    query: ListPartiesQueryDto,
  ): Promise<{ data: PartyListItemView[]; meta: PaginationMeta }> {
    const page = query.page;
    const pageSize = query.pageSize;
    const search = normalizeSearchQuery(query.search);
    const sortBy = query.sortBy ?? 'updatedAt';
    const sortDir = query.sortDir ?? 'desc';
    const where: Prisma.PartyWhereInput = {
      companyId: company.companyId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.role
        ? {
            roles: {
              some: {
                companyId: company.companyId,
                roleType: query.role,
                status: PartyRoleStatus.ACTIVE,
              },
            },
          }
        : {}),
    };

    if (search) {
      where.OR = [
        { partyCode: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { legalName: { contains: search, mode: 'insensitive' } },
        { tradeName: { contains: search, mode: 'insensitive' } },
        { nationalId: { contains: search, mode: 'insensitive' } },
        { registrationNumber: { contains: search, mode: 'insensitive' } },
        {
          contactPoints: {
            some: {
              companyId: company.companyId,
              status: PartyContactPointStatus.ACTIVE,
              OR: [
                { value: { contains: search, mode: 'insensitive' } },
                { normalizedValue: { contains: search.toLowerCase() } },
              ],
            },
          },
        },
      ];
    }

    const orderBy: Prisma.PartyOrderByWithRelationInput[] = [
      { [sortBy]: sortDir },
      { id: 'desc' },
    ];

    const [total, rows] = await Promise.all([
      this.database.client.party.count({ where }),
      this.database.client.party.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          roles: {
            where: { status: PartyRoleStatus.ACTIVE },
            select: { roleType: true },
            orderBy: { roleType: 'asc' },
          },
          contactPoints: {
            where: {
              status: PartyContactPointStatus.ACTIVE,
              isPrimary: true,
              type: { in: [PartyContactPointType.MOBILE, PartyContactPointType.EMAIL] },
            },
            select: { type: true, value: true },
          },
        },
      }),
    ]);

    return {
      data: rows.map((r) => {
        const primaryMobile =
          r.contactPoints.find((c) => c.type === PartyContactPointType.MOBILE)?.value ?? null;
        const primaryEmail =
          r.contactPoints.find((c) => c.type === PartyContactPointType.EMAIL)?.value ?? null;
        return {
          ...this.toPartyView(r),
          primaryMobile,
          primaryEmail,
          roles: r.roles.map((role) => role.roleType),
        };
      }),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async get(company: CompanyContext, partyId: string): Promise<PartyDetailView> {
    const row = await this.database.client.party.findFirst({
      where: { id: partyId, companyId: company.companyId },
      include: {
        contactPoints: { orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] },
        addresses: {
          where: { archivedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
        roles: { orderBy: [{ status: 'asc' }, { roleType: 'asc' }, { startedAt: 'desc' }] },
      },
    });
    if (!row) throw this.notFound();
    return {
      ...this.toPartyView(row),
      contacts: row.contactPoints.map((c) => this.toContactView(c)),
      addresses: row.addresses.map((a) => this.toAddressView(a)),
      roles: row.roles.map((r) => this.toRoleView(r)),
    };
  }

  /**
   * Permission-aware related-domain summaries. Party is navigation only —
   * owning domains remain source-of-truth. Omitted sections never leak data.
   */
  async getRelatedEntities(
    company: CompanyContext,
    partyId: string,
    permissions: PermissionKey[],
  ): Promise<PartyRelatedEntitiesView> {
    await this.requireParty(company.companyId, partyId);
    const perm = new Set(permissions);
    const canPurchasing = perm.has(PERMISSIONS.PURCHASING_READ);
    const canSales = perm.has(PERMISSIONS.SALES_CUSTOMERS_READ);
    const canFinanceLoans = perm.has(PERMISSIONS.FINANCE_LOANS_READ);
    const canFinanceCapital = perm.has(PERMISSIONS.FINANCE_CAPITAL_READ);
    const canFinance = canFinanceLoans || canFinanceCapital;

    const result: PartyRelatedEntitiesView = {
      supplier: null,
      customer: null,
      partner: null,
      loansAsLender: [],
      loansAsBorrower: [],
      capitalContributions: [],
      contactRelationships: [],
      omitted: {
        purchasing: !canPurchasing,
        sales: !canSales,
        finance: !canFinance,
      },
    };

    const contactRels = await this.database.client.partyRelationship.findMany({
      where: {
        companyId: company.companyId,
        OR: [{ fromPartyId: partyId }, { toPartyId: partyId }],
        status: PartyRelationshipStatus.ACTIVE,
      },
      include: {
        fromParty: { select: { id: true, partyCode: true, displayName: true } },
        toParty: { select: { id: true, partyCode: true, displayName: true } },
      },
      take: 50,
    });
    result.contactRelationships = contactRels.map((rel) => {
      const isFrom = rel.fromPartyId === partyId;
      const related = isFrom ? rel.toParty : rel.fromParty;
      return {
        relationshipId: rel.id,
        direction: isFrom ? ('FROM' as const) : ('TO' as const),
        relatedPartyId: related.id,
        relatedPartyCode: related.partyCode,
        relatedDisplayName: related.displayName,
        type: rel.type,
        status: rel.status,
      };
    });

    if (canPurchasing) {
      const supplier = await this.database.client.supplier.findFirst({
        where: { companyId: company.companyId, partyId },
        select: { id: true, code: true, status: true },
      });
      if (supplier) {
        const openPurchaseOrderCount = await this.database.client.purchaseOrder.count({
          where: {
            companyId: company.companyId,
            supplierId: supplier.id,
            status: {
              in: [
                PurchaseOrderStatus.DRAFT,
                PurchaseOrderStatus.APPROVED,
                PurchaseOrderStatus.ORDERED,
                PurchaseOrderStatus.PARTIALLY_RECEIVED,
              ],
            },
          },
        });
        result.supplier = {
          id: supplier.id,
          code: supplier.code,
          status: supplier.status,
          openPurchaseOrderCount,
        };
      }

      const partner = await this.database.client.partner.findFirst({
        where: { companyId: company.companyId, partyId },
        select: { id: true, status: true },
      });
      if (partner) {
        result.partner = { id: partner.id, status: partner.status };
      }
    }

    if (canSales) {
      const customer = await this.database.client.customer.findFirst({
        where: { companyId: company.companyId, partyId },
        select: { id: true, code: true, status: true },
      });
      if (customer) {
        const openSalesOrderCount = await this.database.client.salesOrder.count({
          where: {
            companyId: company.companyId,
            customerId: customer.id,
            status: {
              in: [
                SalesOrderStatus.DRAFT,
                SalesOrderStatus.CONFIRMED,
                SalesOrderStatus.PROCESSING,
                SalesOrderStatus.PARTIALLY_FULFILLED,
              ],
            },
          },
        });
        result.customer = {
          id: customer.id,
          code: customer.code,
          status: customer.status,
          openSalesOrderCount,
        };
      }
    }

    if (canFinanceLoans) {
      const [asLender, asBorrower] = await Promise.all([
        this.database.client.loan.findMany({
          where: { companyId: company.companyId, lenderPartyId: partyId },
          select: {
            id: true,
            number: true,
            currency: true,
            status: true,
            contractedPrincipal: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.database.client.loan.findMany({
          where: { companyId: company.companyId, borrowerPartyId: partyId },
          select: {
            id: true,
            number: true,
            currency: true,
            status: true,
            contractedPrincipal: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      ]);
      result.loansAsLender = asLender.map((l) => ({
        id: l.id,
        number: l.number,
        currency: l.currency,
        status: l.status,
        contractedPrincipal: l.contractedPrincipal.toString(),
      }));
      result.loansAsBorrower = asBorrower.map((l) => ({
        id: l.id,
        number: l.number,
        currency: l.currency,
        status: l.status,
        contractedPrincipal: l.contractedPrincipal.toString(),
      }));
    }

    if (canFinanceCapital) {
      const capital = await this.database.client.capitalContribution.findMany({
        where: { companyId: company.companyId, contributorPartyId: partyId },
        select: {
          id: true,
          number: true,
          currency: true,
          status: true,
          amount: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      result.capitalContributions = capital.map((c) => ({
        id: c.id,
        number: c.number,
        currency: c.currency,
        status: c.status,
        amount: c.amount.toString(),
      }));
    }

    return result;
  }

  async create(company: CompanyContext, dto: CreatePartyDto): Promise<PartyDetailView> {
    const firstName = assertPersonName(dto.firstName) ?? null;
    const lastName = assertPersonName(dto.lastName) ?? null;
    const legalName = assertLegalName(dto.legalName) ?? null;
    const tradeName = assertTradeName(dto.tradeName) ?? null;
    const displayName = resolveDisplayName({
      type: dto.type,
      displayName: dto.displayName,
      firstName,
      lastName,
      legalName,
      tradeName,
    });
    const nationalId = assertIdField(dto.nationalId) ?? null;
    const registrationNumber = assertIdField(dto.registrationNumber) ?? null;
    const taxId = assertIdField(dto.taxId) ?? null;
    const notes = assertNotes(dto.notes) ?? null;
    const birthDate = dto.birthDate ? new Date(dto.birthDate) : null;
    const actorId = this.optionalActorUserId();
    const roleTypes = [...new Set(dto.roles ?? [])];

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const createdId = await this.database.client.$transaction(async (tx) => {
          const seq = await allocatePartySequence(tx, company.companyId);
          const partyCode = formatPartyCode(seq);
          const party = await tx.party.create({
            data: {
              companyId: company.companyId,
              partyCode,
              type: dto.type,
              status: PartyStatus.ACTIVE,
              displayName,
              firstName: dto.type === PartyType.INDIVIDUAL ? firstName : null,
              lastName: dto.type === PartyType.INDIVIDUAL ? lastName : null,
              birthDate: dto.type === PartyType.INDIVIDUAL ? birthDate : null,
              legalName: dto.type === PartyType.ORGANIZATION ? legalName : null,
              tradeName: dto.type === PartyType.ORGANIZATION ? tradeName : null,
              nationalId,
              registrationNumber,
              taxId,
              notes,
              createdById: actorId,
              updatedById: actorId,
            },
          });

          for (const contact of dto.contacts ?? []) {
            await this.createContactInTx(tx, company.companyId, party.id, contact);
          }
          for (const address of dto.addresses ?? []) {
            await this.createAddressInTx(tx, company.companyId, party.id, address);
          }
          for (const roleType of roleTypes) {
            await tx.partyRole.create({
              data: {
                companyId: company.companyId,
                partyId: party.id,
                roleType,
                status: PartyRoleStatus.ACTIVE,
              },
            });
          }

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PARTY_CREATED,
            entityType: AUDIT_ENTITY_TYPES.PARTY,
            entityId: party.id,
            before: null,
            after: this.auditPartySnapshot(party),
          });
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PARTY_CREATED,
              payload: {
                companyId: company.companyId,
                partyId: party.id,
                partyCode: party.partyCode,
                type: party.type,
              },
            }),
          );
          return party.id;
        }, TX_OPTIONS);
        return this.get(company, createdId);
      } catch (error) {
        mapPartyUniqueViolation(error);
      }
    });
  }

  async updateIdentity(
    company: CompanyContext,
    partyId: string,
    dto: UpdatePartyDto,
  ): Promise<PartyView> {
    const current = await this.requireParty(company.companyId, partyId);
    if (current.status === PartyStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ARCHIVED_IMMUTABLE,
        message: PARTY_ERROR_MESSAGES.ARCHIVED_IMMUTABLE,
        statusCode: 409,
      });
    }

    const firstName =
      dto.firstName !== undefined ? (assertPersonName(dto.firstName) ?? null) : current.firstName;
    const lastName =
      dto.lastName !== undefined ? (assertPersonName(dto.lastName) ?? null) : current.lastName;
    const legalName =
      dto.legalName !== undefined ? (assertLegalName(dto.legalName) ?? null) : current.legalName;
    const tradeName =
      dto.tradeName !== undefined ? (assertTradeName(dto.tradeName) ?? null) : current.tradeName;
    const displayName = resolveDisplayName({
      type: current.type,
      displayName: dto.displayName !== undefined ? dto.displayName : current.displayName,
      firstName: current.type === PartyType.INDIVIDUAL ? firstName : null,
      lastName: current.type === PartyType.INDIVIDUAL ? lastName : null,
      legalName: current.type === PartyType.ORGANIZATION ? legalName : null,
      tradeName: current.type === PartyType.ORGANIZATION ? tradeName : null,
    });
    const nationalId =
      dto.nationalId !== undefined ? (assertIdField(dto.nationalId) ?? null) : current.nationalId;
    const registrationNumber =
      dto.registrationNumber !== undefined
        ? (assertIdField(dto.registrationNumber) ?? null)
        : current.registrationNumber;
    const taxId = dto.taxId !== undefined ? (assertIdField(dto.taxId) ?? null) : current.taxId;
    const notes = dto.notes !== undefined ? (assertNotes(dto.notes) ?? null) : current.notes;
    const birthDate =
      dto.birthDate === undefined
        ? current.birthDate
        : dto.birthDate === null
          ? null
          : new Date(dto.birthDate);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const row = await tx.party.update({
            where: { id: current.id },
            data: {
              displayName,
              firstName: current.type === PartyType.INDIVIDUAL ? firstName : null,
              lastName: current.type === PartyType.INDIVIDUAL ? lastName : null,
              birthDate: current.type === PartyType.INDIVIDUAL ? birthDate : null,
              legalName: current.type === PartyType.ORGANIZATION ? legalName : null,
              tradeName: current.type === PartyType.ORGANIZATION ? tradeName : null,
              nationalId,
              registrationNumber,
              taxId,
              notes,
              updatedById: this.optionalActorUserId(),
            },
          });
          const before = this.auditPartySnapshot(current);
          const after = this.auditPartySnapshot(row);
          if (!auditSnapshotsEqual(before, after)) {
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.PARTY_UPDATED,
              entityType: AUDIT_ENTITY_TYPES.PARTY,
              entityId: row.id,
              before,
              after,
            });
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PARTY_UPDATED,
                payload: {
                  companyId: company.companyId,
                  partyId: row.id,
                  partyCode: row.partyCode,
                },
              }),
            );
          }
          return row;
        }, TX_OPTIONS);
        return this.toPartyView(updated);
      } catch (error) {
        mapPartyUniqueViolation(error);
      }
    });
  }

  async activate(company: CompanyContext, partyId: string): Promise<PartyView> {
    return this.changeStatus(company, partyId, PartyStatus.ACTIVE, AUDIT_ACTIONS.PARTY_ACTIVATED, DOMAIN_EVENTS.PARTY_ACTIVATED);
  }

  async deactivate(company: CompanyContext, partyId: string): Promise<PartyView> {
    return this.changeStatus(
      company,
      partyId,
      PartyStatus.INACTIVE,
      AUDIT_ACTIONS.PARTY_DEACTIVATED,
      DOMAIN_EVENTS.PARTY_DEACTIVATED,
    );
  }

  async archive(company: CompanyContext, partyId: string): Promise<PartyView> {
    const activeSupplier = await this.database.client.supplier.findFirst({
      where: {
        companyId: company.companyId,
        partyId,
        status: { not: PurchasingLifecycleStatus.ARCHIVED },
      },
      select: { id: true },
    });
    const activeCustomer = await this.database.client.customer.findFirst({
      where: {
        companyId: company.companyId,
        partyId,
        archivedAt: null,
        status: CustomerStatus.ACTIVE,
      },
      select: { id: true },
    });
    const activePartner = await this.database.client.partner.findFirst({
      where: {
        companyId: company.companyId,
        partyId,
        status: { not: PartnerStatus.ARCHIVED },
      },
      select: { id: true },
    });
    const openLoan = await this.database.client.loan.findFirst({
      where: {
        companyId: company.companyId,
        OR: [{ lenderPartyId: partyId }, { borrowerPartyId: partyId }],
        status: { in: OPEN_LOAN_STATUSES },
      },
      select: { id: true },
    });
    if (activeSupplier || activeCustomer || activePartner || openLoan) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ARCHIVE_BLOCKED,
        message: PARTY_ERROR_MESSAGES.ARCHIVE_BLOCKED,
        statusCode: 409,
      });
    }
    return this.changeStatus(
      company,
      partyId,
      PartyStatus.ARCHIVED,
      AUDIT_ACTIONS.PARTY_ARCHIVED,
      DOMAIN_EVENTS.PARTY_ARCHIVED,
      true,
    );
  }

  async addContact(
    company: CompanyContext,
    partyId: string,
    dto: CreatePartyContactDto,
  ): Promise<PartyContactView> {
    await this.requireParty(company.companyId, partyId);
    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const row = await this.createContactInTx(tx, company.companyId, partyId, dto);
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PARTY_CONTACT_CREATED,
            entityType: AUDIT_ENTITY_TYPES.PARTY_CONTACT_POINT,
            entityId: row.id,
            before: null,
            after: { partyId, type: row.type, isPrimary: row.isPrimary, status: row.status },
          });
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PARTY_CONTACT_CREATED,
              payload: {
                companyId: company.companyId,
                partyId,
                contactId: row.id,
                type: row.type,
              },
            }),
          );
          return row;
        }, TX_OPTIONS);
        return this.toContactView(created);
      } catch (error) {
        mapPartyUniqueViolation(error);
      }
    });
  }

  async updateContact(
    company: CompanyContext,
    partyId: string,
    contactId: string,
    dto: UpdatePartyContactDto,
  ): Promise<PartyContactView> {
    const current = await this.requireContact(company.companyId, partyId, contactId);
    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          if (dto.isPrimary === true) {
            await tx.partyContactPoint.updateMany({
              where: {
                companyId: company.companyId,
                partyId,
                type: current.type,
                status: PartyContactPointStatus.ACTIVE,
                isPrimary: true,
                id: { not: contactId },
              },
              data: { isPrimary: false },
            });
          }
          const valueBundle =
            dto.value !== undefined
              ? normalizeContactValue(current.type, dto.value)
              : { value: current.value, normalizedValue: current.normalizedValue };
          const row = await tx.partyContactPoint.update({
            where: { id: contactId },
            data: {
              value: valueBundle.value,
              normalizedValue: valueBundle.normalizedValue,
              label:
                dto.label !== undefined ? (assertContactLabel(dto.label) ?? null) : current.label,
              isPrimary: dto.isPrimary !== undefined ? dto.isPrimary : current.isPrimary,
            },
          });
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PARTY_CONTACT_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.PARTY_CONTACT_POINT,
            entityId: row.id,
            before: { type: current.type, isPrimary: current.isPrimary, status: current.status },
            after: { type: row.type, isPrimary: row.isPrimary, status: row.status },
          });
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PARTY_CONTACT_UPDATED,
              payload: { companyId: company.companyId, partyId, contactId: row.id },
            }),
          );
          if (dto.isPrimary === true && !current.isPrimary) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PARTY_CONTACT_PRIMARY_CHANGED,
                payload: {
                  companyId: company.companyId,
                  partyId,
                  contactId: row.id,
                  type: row.type,
                },
              }),
            );
          }
          return row;
        }, TX_OPTIONS);
        return this.toContactView(updated);
      } catch (error) {
        mapPartyUniqueViolation(error);
      }
    });
  }

  async setPrimaryContact(
    company: CompanyContext,
    partyId: string,
    contactId: string,
  ): Promise<PartyContactView> {
    return this.updateContact(company, partyId, contactId, { isPrimary: true });
  }

  async deactivateContact(
    company: CompanyContext,
    partyId: string,
    contactId: string,
  ): Promise<PartyContactView> {
    const current = await this.requireContact(company.companyId, partyId, contactId);
    if (current.status === PartyContactPointStatus.INACTIVE) {
      return this.toContactView(current);
    }
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const row = await tx.partyContactPoint.update({
          where: { id: contactId },
          data: { status: PartyContactPointStatus.INACTIVE, isPrimary: false },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PARTY_CONTACT_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.PARTY_CONTACT_POINT,
          entityId: row.id,
          before: { status: current.status, isPrimary: current.isPrimary },
          after: { status: row.status, isPrimary: row.isPrimary },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PARTY_CONTACT_DEACTIVATED,
            payload: { companyId: company.companyId, partyId, contactId: row.id },
          }),
        );
        return row;
      }, TX_OPTIONS);
      return this.toContactView(updated);
    });
  }

  async addAddress(
    company: CompanyContext,
    partyId: string,
    dto: CreatePartyAddressDto,
  ): Promise<PartyAddressView> {
    await this.requireParty(company.companyId, partyId);
    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const row = await this.createAddressInTx(tx, company.companyId, partyId, dto);
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PARTY_ADDRESS_CREATED,
            entityType: AUDIT_ENTITY_TYPES.PARTY_ADDRESS,
            entityId: row.id,
            before: null,
            after: { partyId, type: row.type, isPrimary: row.isPrimary },
          });
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PARTY_ADDRESS_CREATED,
              payload: { companyId: company.companyId, partyId, addressId: row.id },
            }),
          );
          return row;
        }, TX_OPTIONS);
        return this.toAddressView(created);
      } catch (error) {
        mapPartyUniqueViolation(error);
      }
    });
  }

  async updateAddress(
    company: CompanyContext,
    partyId: string,
    addressId: string,
    dto: UpdatePartyAddressDto,
  ): Promise<PartyAddressView> {
    const current = await this.requireAddress(company.companyId, partyId, addressId);
    if (current.archivedAt) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ADDRESS_ALREADY_ARCHIVED,
        message: PARTY_ERROR_MESSAGES.ADDRESS_ARCHIVED,
        statusCode: 409,
      });
    }
    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          if (dto.isPrimary === true) {
            await tx.partyAddress.updateMany({
              where: {
                companyId: company.companyId,
                partyId,
                archivedAt: null,
                isPrimary: true,
                id: { not: addressId },
              },
              data: { isPrimary: false },
            });
          }
          const row = await tx.partyAddress.update({
            where: { id: addressId },
            data: {
              label:
                dto.label !== undefined ? (assertAddressLabel(dto.label) ?? null) : current.label,
              type: dto.type !== undefined ? dto.type : current.type,
              country:
                dto.country !== undefined
                  ? (assertAddressGeo(dto.country) ?? null)
                  : current.country,
              province:
                dto.province !== undefined
                  ? (assertAddressGeo(dto.province) ?? null)
                  : current.province,
              city: dto.city !== undefined ? (assertAddressGeo(dto.city) ?? null) : current.city,
              district:
                dto.district !== undefined
                  ? (assertAddressGeo(dto.district) ?? null)
                  : current.district,
              postalCode:
                dto.postalCode !== undefined
                  ? (assertAddressPostal(dto.postalCode) ?? null)
                  : current.postalCode,
              addressLine1:
                dto.addressLine1 !== undefined
                  ? assertAddressLine1(dto.addressLine1)
                  : current.addressLine1,
              addressLine2:
                dto.addressLine2 !== undefined
                  ? (assertAddressOptionalLine(dto.addressLine2) ?? null)
                  : current.addressLine2,
              recipientName:
                dto.recipientName !== undefined
                  ? (assertAddressRecipient(dto.recipientName) ?? null)
                  : current.recipientName,
              recipientPhone:
                dto.recipientPhone !== undefined
                  ? (assertAddressRecipient(dto.recipientPhone) ?? null)
                  : current.recipientPhone,
              isPrimary: dto.isPrimary !== undefined ? dto.isPrimary : current.isPrimary,
              notes:
                dto.notes !== undefined ? (assertAddressNotes(dto.notes) ?? null) : current.notes,
            },
          });
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PARTY_ADDRESS_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.PARTY_ADDRESS,
            entityId: row.id,
            before: { type: current.type, isPrimary: current.isPrimary },
            after: { type: row.type, isPrimary: row.isPrimary },
          });
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PARTY_ADDRESS_UPDATED,
              payload: { companyId: company.companyId, partyId, addressId: row.id },
            }),
          );
          if (dto.isPrimary === true && !current.isPrimary) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PARTY_ADDRESS_PRIMARY_CHANGED,
                payload: { companyId: company.companyId, partyId, addressId: row.id },
              }),
            );
          }
          return row;
        }, TX_OPTIONS);
        return this.toAddressView(updated);
      } catch (error) {
        mapPartyUniqueViolation(error);
      }
    });
  }

  async setPrimaryAddress(
    company: CompanyContext,
    partyId: string,
    addressId: string,
  ): Promise<PartyAddressView> {
    return this.updateAddress(company, partyId, addressId, { isPrimary: true });
  }

  async archiveAddress(
    company: CompanyContext,
    partyId: string,
    addressId: string,
  ): Promise<PartyAddressView> {
    const current = await this.requireAddress(company.companyId, partyId, addressId);
    if (current.archivedAt) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ADDRESS_ALREADY_ARCHIVED,
        message: PARTY_ERROR_MESSAGES.ADDRESS_ARCHIVED,
        statusCode: 409,
      });
    }
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const row = await tx.partyAddress.update({
          where: { id: addressId },
          data: { archivedAt: new Date(), isPrimary: false },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PARTY_ADDRESS_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.PARTY_ADDRESS,
          entityId: row.id,
          before: { archivedAt: null, isPrimary: current.isPrimary },
          after: {
            archivedAt: row.archivedAt?.toISOString() ?? null,
            isPrimary: row.isPrimary,
          },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PARTY_ADDRESS_ARCHIVED,
            payload: { companyId: company.companyId, partyId, addressId: row.id },
          }),
        );
        return row;
      }, TX_OPTIONS);
      return this.toAddressView(updated);
    });
  }

  async addRole(
    company: CompanyContext,
    partyId: string,
    dto: AddPartyRoleDto,
  ): Promise<PartyRoleView> {
    await this.requireParty(company.companyId, partyId);
    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const row = await tx.partyRole.create({
            data: {
              companyId: company.companyId,
              partyId,
              roleType: dto.roleType,
              status: PartyRoleStatus.ACTIVE,
            },
          });
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PARTY_ROLE_ADDED,
            entityType: AUDIT_ENTITY_TYPES.PARTY_ROLE,
            entityId: row.id,
            before: null,
            after: { partyId, roleType: row.roleType, status: row.status },
          });
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PARTY_ROLE_ADDED,
              payload: {
                companyId: company.companyId,
                partyId,
                roleId: row.id,
                roleType: row.roleType,
              },
            }),
          );
          return row;
        }, TX_OPTIONS);
        return this.toRoleView(created);
      } catch (error) {
        mapPartyUniqueViolation(error);
      }
    });
  }

  async deactivateRole(
    company: CompanyContext,
    partyId: string,
    roleId: string,
  ): Promise<PartyRoleView> {
    const current = await this.requireRole(company.companyId, partyId, roleId);
    if (current.status === PartyRoleStatus.INACTIVE) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ROLE_ALREADY_INACTIVE,
        message: PARTY_ERROR_MESSAGES.ROLE_ALREADY_INACTIVE,
        statusCode: 409,
      });
    }
    await this.assertRoleMayDeactivate(company.companyId, partyId, current.roleType);
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const row = await tx.partyRole.update({
          where: { id: roleId },
          data: { status: PartyRoleStatus.INACTIVE, endedAt: new Date() },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PARTY_ROLE_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.PARTY_ROLE,
          entityId: row.id,
          before: {
            status: current.status,
            endedAt: current.endedAt?.toISOString() ?? null,
          },
          after: {
            status: row.status,
            endedAt: row.endedAt?.toISOString() ?? null,
          },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PARTY_ROLE_DEACTIVATED,
            payload: {
              companyId: company.companyId,
              partyId,
              roleId: row.id,
              roleType: row.roleType,
            },
          }),
        );
        return row;
      }, TX_OPTIONS);
      return this.toRoleView(updated);
    });
  }

  /**
   * Read-only potential duplicate detection. Never merges.
   * Name-only similarity is intentionally ignored.
   */
  async findPotentialDuplicates(
    company: CompanyContext,
    input: PartyDuplicateCheckDto,
  ): Promise<PotentialDuplicateMatch[]> {
    const matches = new Map<string, PotentialDuplicateMatch>();

    const reasonFor = (
      reason: PotentialDuplicateMatch['matchedOn'][number],
    ): PotentialDuplicateMatch['reasonCodes'][number] => {
      switch (reason) {
        case 'nationalId':
          return 'NATIONAL_ID_MATCH';
        case 'registrationNumber':
          return 'REGISTRATION_NUMBER_MATCH';
        case 'mobile':
          return 'MOBILE_MATCH';
        case 'email':
          return 'EMAIL_MATCH';
        case 'phone':
          return 'PHONE_MATCH';
      }
    };

    const strengthFor = (
      reasons: PotentialDuplicateMatch['matchedOn'],
    ): DuplicateMatchStrength => {
      if (reasons.includes('nationalId') || reasons.includes('registrationNumber')) {
        return reasons.length > 1 ? 'EXACT' : 'STRONG';
      }
      return 'POTENTIAL';
    };

    const add = async (
      party: {
        id: string;
        partyCode: string;
        displayName: string;
        type: PartyType;
        status: PartyStatus;
      },
      reason: PotentialDuplicateMatch['matchedOn'][number],
    ) => {
      if (input.excludePartyId && party.id === input.excludePartyId) return;
      const existing = matches.get(party.id);
      if (existing) {
        if (!existing.matchedOn.includes(reason)) {
          existing.matchedOn.push(reason);
          existing.reasonCodes.push(reasonFor(reason));
          existing.matchStrength = strengthFor(existing.matchedOn);
        }
        return;
      }
      const roles = await this.database.client.partyRole.findMany({
        where: {
          companyId: company.companyId,
          partyId: party.id,
          status: PartyRoleStatus.ACTIVE,
        },
        select: { roleType: true },
      });
      matches.set(party.id, {
        partyId: party.id,
        partyCode: party.partyCode,
        displayName: party.displayName,
        type: party.type,
        status: party.status,
        matchedOn: [reason],
        reasonCodes: [reasonFor(reason)],
        matchStrength: strengthFor([reason]),
        roles: roles.map((r) => r.roleType),
      });
    };

    if (input.nationalId) {
      const rows = await this.database.client.party.findMany({
        where: { companyId: company.companyId, nationalId: assertIdField(input.nationalId) },
        select: {
          id: true,
          partyCode: true,
          displayName: true,
          type: true,
          status: true,
        },
      });
      for (const row of rows) await add(row, 'nationalId');
    }

    if (input.registrationNumber) {
      const rows = await this.database.client.party.findMany({
        where: {
          companyId: company.companyId,
          registrationNumber: assertIdField(input.registrationNumber),
        },
        select: {
          id: true,
          partyCode: true,
          displayName: true,
          type: true,
          status: true,
        },
      });
      for (const row of rows) await add(row, 'registrationNumber');
    }

    const contactChecks: Array<{
      type: PartyContactPointType;
      value: string;
      reason: PotentialDuplicateMatch['matchedOn'][number];
    }> = [];
    if (input.mobile) {
      contactChecks.push({
        type: PartyContactPointType.MOBILE,
        value: input.mobile,
        reason: 'mobile',
      });
    }
    if (input.phone) {
      contactChecks.push({
        type: PartyContactPointType.PHONE,
        value: input.phone,
        reason: 'phone',
      });
    }
    if (input.email) {
      contactChecks.push({
        type: PartyContactPointType.EMAIL,
        value: input.email,
        reason: 'email',
      });
    }

    for (const check of contactChecks) {
      const { normalizedValue } = normalizeContactValue(check.type, check.value);
      const contacts = await this.database.client.partyContactPoint.findMany({
        where: {
          companyId: company.companyId,
          type: check.type,
          normalizedValue,
          status: PartyContactPointStatus.ACTIVE,
        },
        select: {
          party: {
            select: {
              id: true,
              partyCode: true,
              displayName: true,
              type: true,
              status: true,
            },
          },
        },
      });
      for (const c of contacts) await add(c.party, check.reason);
    }

    // displayName is accepted on the DTO for UX context only — never matched.
    void input.displayName;
    void input.type;

    return [...matches.values()].sort((a, b) => {
      const rank = { EXACT: 0, STRONG: 1, POTENTIAL: 2 };
      return rank[a.matchStrength] - rank[b.matchStrength];
    });
  }

  private async assertRoleMayDeactivate(
    companyId: string,
    partyId: string,
    roleType: PartyRoleType,
  ): Promise<void> {
    let blocked = false;
    if (roleType === PartyRoleType.SUPPLIER) {
      blocked = Boolean(
        await this.database.client.supplier.findFirst({
          where: {
            companyId,
            partyId,
            status: { not: PurchasingLifecycleStatus.ARCHIVED },
          },
          select: { id: true },
        }),
      );
    } else if (roleType === PartyRoleType.CUSTOMER) {
      blocked = Boolean(
        await this.database.client.customer.findFirst({
          where: {
            companyId,
            partyId,
            archivedAt: null,
            status: CustomerStatus.ACTIVE,
          },
          select: { id: true },
        }),
      );
    } else if (roleType === PartyRoleType.PARTNER) {
      blocked = Boolean(
        await this.database.client.partner.findFirst({
          where: { companyId, partyId, status: { not: PartnerStatus.ARCHIVED } },
          select: { id: true },
        }),
      );
    } else if (roleType === PartyRoleType.LENDER) {
      blocked = Boolean(
        await this.database.client.loan.findFirst({
          where: {
            companyId,
            lenderPartyId: partyId,
            status: { in: OPEN_LOAN_STATUSES },
          },
          select: { id: true },
        }),
      );
    } else if (roleType === PartyRoleType.BORROWER) {
      blocked = Boolean(
        await this.database.client.loan.findFirst({
          where: {
            companyId,
            borrowerPartyId: partyId,
            status: { in: OPEN_LOAN_STATUSES },
          },
          select: { id: true },
        }),
      );
    }

    if (blocked) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ROLE_DOMAIN_LINKED,
        message: PARTY_ERROR_MESSAGES.ROLE_DOMAIN_LINKED,
        statusCode: 409,
      });
    }
  }

  private async changeStatus(
    company: CompanyContext,
    partyId: string,
    next: PartyStatus,
    auditAction: (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS],
    eventType: (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS],
    setArchivedAt = false,
  ): Promise<PartyView> {
    const current = await this.requireParty(company.companyId, partyId);
    if (current.status === next) {
      return this.toPartyView(current);
    }
    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const row = await tx.party.update({
          where: { id: current.id },
          data: {
            status: next,
            archivedAt: setArchivedAt
              ? (current.archivedAt ?? new Date())
              : next === PartyStatus.ACTIVE
                ? null
                : current.archivedAt,
            updatedById: this.optionalActorUserId(),
          },
        });
        await this.auditService.record(tx, {
          action: auditAction,
          entityType: AUDIT_ENTITY_TYPES.PARTY,
          entityId: row.id,
          before: { status: current.status },
          after: { status: row.status },
        });
        events.push(
          this.eventFactory.create({
            type: eventType,
            payload: {
              companyId: company.companyId,
              partyId: row.id,
              partyCode: row.partyCode,
              status: row.status,
            },
          }),
        );
        return row;
      }, TX_OPTIONS);
      return this.toPartyView(updated);
    });
  }

  private async createContactInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    partyId: string,
    dto: { type: PartyContactPointType; value: string; label?: string; isPrimary?: boolean },
  ): Promise<ContactRow> {
    const { value, normalizedValue } = normalizeContactValue(dto.type, dto.value);
    const isPrimary = dto.isPrimary === true;
    if (isPrimary) {
      await tx.partyContactPoint.updateMany({
        where: {
          companyId,
          partyId,
          type: dto.type,
          status: PartyContactPointStatus.ACTIVE,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }
    return tx.partyContactPoint.create({
      data: {
        companyId,
        partyId,
        type: dto.type,
        value,
        normalizedValue,
        label: assertContactLabel(dto.label) ?? null,
        isPrimary,
        status: PartyContactPointStatus.ACTIVE,
      },
    });
  }

  private async createAddressInTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    partyId: string,
    dto: CreatePartyAddressDto,
  ): Promise<AddressRow> {
    const isPrimary = dto.isPrimary === true;
    if (isPrimary) {
      await tx.partyAddress.updateMany({
        where: { companyId, partyId, archivedAt: null, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.partyAddress.create({
      data: {
        companyId,
        partyId,
        label: assertAddressLabel(dto.label) ?? null,
        type: dto.type ?? PartyAddressType.GENERAL,
        country: assertAddressGeo(dto.country) ?? null,
        province: assertAddressGeo(dto.province) ?? null,
        city: assertAddressGeo(dto.city) ?? null,
        district: assertAddressGeo(dto.district) ?? null,
        postalCode: assertAddressPostal(dto.postalCode) ?? null,
        addressLine1: assertAddressLine1(dto.addressLine1),
        addressLine2: assertAddressOptionalLine(dto.addressLine2) ?? null,
        recipientName: assertAddressRecipient(dto.recipientName) ?? null,
        recipientPhone: assertAddressRecipient(dto.recipientPhone) ?? null,
        isPrimary,
        notes: assertAddressNotes(dto.notes) ?? null,
      },
    });
  }

  private async requireParty(companyId: string, partyId: string): Promise<PartyRow> {
    const row = await this.database.client.party.findFirst({
      where: { id: partyId, companyId },
    });
    if (!row) throw this.notFound();
    return row;
  }

  private async requireContact(
    companyId: string,
    partyId: string,
    contactId: string,
  ): Promise<ContactRow> {
    const row = await this.database.client.partyContactPoint.findFirst({
      where: { id: contactId, companyId, partyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PARTY_CONTACT_NOT_FOUND,
        message: PARTY_ERROR_MESSAGES.CONTACT_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async requireAddress(
    companyId: string,
    partyId: string,
    addressId: string,
  ): Promise<AddressRow> {
    const row = await this.database.client.partyAddress.findFirst({
      where: { id: addressId, companyId, partyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ADDRESS_NOT_FOUND,
        message: PARTY_ERROR_MESSAGES.ADDRESS_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async requireRole(
    companyId: string,
    partyId: string,
    roleId: string,
  ): Promise<RoleRow> {
    const row = await this.database.client.partyRole.findFirst({
      where: { id: roleId, companyId, partyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ROLE_NOT_FOUND,
        message: PARTY_ERROR_MESSAGES.ROLE_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private notFound(): AppError {
    return new AppError({
      code: ERROR_CODES.PARTY_NOT_FOUND,
      message: PARTY_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }

  private optionalActorUserId(): string | null {
    return getRequestContext()?.userId ?? null;
  }

  private auditPartySnapshot(row: PartyRow) {
    return {
      partyCode: row.partyCode,
      type: row.type,
      status: row.status,
      displayName: row.displayName,
      // Intentionally omit nationalId / taxId / contacts from audit payloads.
    };
  }

  private toPartyView(row: PartyRow): PartyView {
    return {
      id: row.id,
      companyId: row.companyId,
      partyCode: row.partyCode,
      type: row.type,
      status: row.status,
      displayName: row.displayName,
      firstName: row.firstName,
      lastName: row.lastName,
      birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
      legalName: row.legalName,
      tradeName: row.tradeName,
      nationalId: row.nationalId,
      registrationNumber: row.registrationNumber,
      taxId: row.taxId,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }

  private toContactView(row: ContactRow): PartyContactView {
    return {
      id: row.id,
      companyId: row.companyId,
      partyId: row.partyId,
      type: row.type,
      value: row.value,
      label: row.label,
      isPrimary: row.isPrimary,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toAddressView(row: AddressRow): PartyAddressView {
    return {
      id: row.id,
      companyId: row.companyId,
      partyId: row.partyId,
      label: row.label,
      type: row.type,
      country: row.country,
      province: row.province,
      city: row.city,
      district: row.district,
      postalCode: row.postalCode,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      recipientName: row.recipientName,
      recipientPhone: row.recipientPhone,
      isPrimary: row.isPrimary,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }

  private toRoleView(row: RoleRow): PartyRoleView {
    return {
      id: row.id,
      companyId: row.companyId,
      partyId: row.partyId,
      roleType: row.roleType,
      status: row.status,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
