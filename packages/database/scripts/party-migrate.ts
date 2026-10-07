/**
 * Phase 5.5.2 — Party domain linking migration / backfill.
 *
 * Usage:
 *   pnpm party:migrate --dry-run
 *   pnpm party:migrate --apply
 *
 * Deterministic, idempotent, tenant-safe, batched.
 * Never auto-merges on name alone.
 * Does not emit operational domain events.
 * Does not alter financial amounts.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {
  CustomerType,
  PartyAddressType,
  PartyContactPointStatus,
  PartyContactPointType,
  PartyMigrationMatchTier,
  PartyMigrationSourceType,
  PartyRelationshipStatus,
  PartyRelationshipType,
  PartyRoleStatus,
  PartyRoleType,
  PartyStatus,
  PartyType,
  Prisma,
  PrismaClient,
} from '../src/generated/prisma/client';
import {
  addressFingerprint,
  hasContactIdentity,
  hasStrongIdentity,
  normalizeDisplayName,
  normalizeEmailForLookup,
  normalizeIdField,
  normalizePhoneForLookup,
} from './lib/party-identity-matching';

function loadRootEnv(): void {
  for (const path of [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../.env'),
  ]) {
    if (existsSync(path)) {
      config({ path, quiet: true });
      return;
    }
  }
}

loadRootEnv();

const BATCH = 100;

type Stats = {
  suppliersScanned: number;
  customersScanned: number;
  supplierContactsScanned: number;
  loansScanned: number;
  capitalScanned: number;
  partiesCreated: number;
  partiesReused: number;
  strongMatches: number;
  contactMatches: number;
  ambiguousSeparate: number;
  potentialDuplicates: number;
  rolesAdded: number;
  contactsMigrated: number;
  addressesMigrated: number;
  relationshipsCreated: number;
  partnersCreated: number;
  linksWritten: number;
  skippedAlreadyLinked: number;
  failures: number;
};

function emptyStats(): Stats {
  return {
    suppliersScanned: 0,
    customersScanned: 0,
    supplierContactsScanned: 0,
    loansScanned: 0,
    capitalScanned: 0,
    partiesCreated: 0,
    partiesReused: 0,
    strongMatches: 0,
    contactMatches: 0,
    ambiguousSeparate: 0,
    potentialDuplicates: 0,
    rolesAdded: 0,
    contactsMigrated: 0,
    addressesMigrated: 0,
    relationshipsCreated: 0,
    partnersCreated: 0,
    linksWritten: 0,
    skippedAlreadyLinked: 0,
    failures: 0,
  };
}

type ResolveResult = {
  partyId: string;
  tier: PartyMigrationMatchTier;
  created: boolean;
};

function parseArgs(argv: string[]): { dryRun: boolean; apply: boolean } {
  const dryRun = argv.includes('--dry-run');
  const apply = argv.includes('--apply');
  if (!dryRun && !apply) {
    return { dryRun: true, apply: false };
  }
  if (dryRun && apply) {
    console.error('Use either --dry-run or --apply, not both.');
    process.exit(2);
  }
  return { dryRun: !apply, apply };
}

async function allocatePartyCode(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<string> {
  const seq = await tx.partySequence.upsert({
    where: { companyId },
    update: { nextValue: { increment: 1 } },
    create: { companyId, nextValue: 2 },
  });
  // upsert returns the row AFTER update; when create nextValue=2 means we used 1
  const used = seq.nextValue - 1;
  return `PTY-${String(used).padStart(6, '0')}`;
}

async function ensureRole(
  tx: Prisma.TransactionClient,
  companyId: string,
  partyId: string,
  roleType: PartyRoleType,
  stats: Stats,
  dryRun: boolean,
): Promise<void> {
  const existing = await tx.partyRole.findFirst({
    where: { companyId, partyId, roleType },
  });
  if (existing) {
    if (existing.status !== PartyRoleStatus.ACTIVE && !dryRun) {
      await tx.partyRole.update({
        where: { id: existing.id },
        data: { status: PartyRoleStatus.ACTIVE, endedAt: null },
      });
    }
    return;
  }
  stats.rolesAdded += 1;
  if (dryRun) return;
  await tx.partyRole.create({
    data: {
      companyId,
      partyId,
      roleType,
      status: PartyRoleStatus.ACTIVE,
    },
  });
}

async function ensureContact(
  tx: Prisma.TransactionClient,
  companyId: string,
  partyId: string,
  type: PartyContactPointType,
  raw: string | null | undefined,
  isPrimary: boolean,
  stats: Stats,
  dryRun: boolean,
): Promise<void> {
  if (!raw?.trim()) return;
  const value = raw.trim();
  const normalizedValue =
    type === PartyContactPointType.EMAIL
      ? normalizeEmailForLookup(value)
      : type === PartyContactPointType.MOBILE ||
          type === PartyContactPointType.PHONE ||
          type === PartyContactPointType.WHATSAPP
        ? normalizePhoneForLookup(value)
        : value.toLowerCase();

  const existing = await tx.partyContactPoint.findFirst({
    where: { companyId, partyId, type, normalizedValue },
  });
  if (existing) return;

  stats.contactsMigrated += 1;
  if (dryRun) return;
  await tx.partyContactPoint.create({
    data: {
      companyId,
      partyId,
      type,
      value,
      normalizedValue,
      isPrimary,
      status: PartyContactPointStatus.ACTIVE,
    },
  });
}

async function ensureAddress(
  tx: Prisma.TransactionClient,
  companyId: string,
  partyId: string,
  input: {
    type: PartyAddressType;
    addressLine1: string;
    addressLine2?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
    label?: string | null;
    recipientName?: string | null;
    recipientPhone?: string | null;
    isPrimary?: boolean;
    notes?: string | null;
  },
  stats: Stats,
  dryRun: boolean,
): Promise<void> {
  const line1 = normalizeDisplayName(input.addressLine1);
  if (!line1) return;
  const fp = addressFingerprint({
    type: input.type,
    addressLine1: line1,
    addressLine2: input.addressLine2,
    city: input.city,
    province: input.province,
    postalCode: input.postalCode,
    country: input.country,
  });

  const candidates = await tx.partyAddress.findMany({
    where: { companyId, partyId, archivedAt: null },
  });
  for (const row of candidates) {
    const existingFp = addressFingerprint({
      type: row.type,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      province: row.province,
      postalCode: row.postalCode,
      country: row.country,
    });
    if (existingFp === fp) return;
  }

  stats.addressesMigrated += 1;
  if (dryRun) return;
  await tx.partyAddress.create({
    data: {
      companyId,
      partyId,
      type: input.type,
      addressLine1: line1,
      addressLine2: input.addressLine2 ?? null,
      city: input.city ?? null,
      province: input.province ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? null,
      label: input.label ?? null,
      recipientName: input.recipientName ?? null,
      recipientPhone: input.recipientPhone ?? null,
      isPrimary: input.isPrimary ?? false,
      notes: input.notes ?? null,
    },
  });
}

async function findStrongMatch(
  tx: Prisma.TransactionClient,
  companyId: string,
  type: PartyType,
  identity: {
    nationalId?: string | null;
    registrationNumber?: string | null;
    taxId?: string | null;
  },
): Promise<string | null> {
  const nationalId = normalizeIdField(identity.nationalId);
  const registrationNumber = normalizeIdField(identity.registrationNumber);
  const taxId = normalizeIdField(identity.taxId);
  if (!nationalId && !registrationNumber && !taxId) return null;

  const or: Prisma.PartyWhereInput[] = [];
  if (nationalId) or.push({ nationalId });
  if (registrationNumber) or.push({ registrationNumber });
  if (taxId) or.push({ taxId });

  const rows = await tx.party.findMany({
    where: {
      companyId,
      type,
      status: { not: PartyStatus.ARCHIVED },
      OR: or,
    },
    take: 5,
  });

  // Require exact field equality for the signal that matched (avoid weak OR collisions).
  const exact = rows.filter((p) => {
    if (nationalId && p.nationalId === nationalId) return true;
    if (registrationNumber && p.registrationNumber === registrationNumber) return true;
    if (taxId && p.taxId === taxId) return true;
    return false;
  });
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) return null; // ambiguous strong — do not merge
  return null;
}

async function findContactMatch(
  tx: Prisma.TransactionClient,
  companyId: string,
  type: PartyType,
  contacts: { mobile?: string | null; phone?: string | null; email?: string | null },
): Promise<string | null> {
  const norms: Array<{ type: PartyContactPointType; normalizedValue: string }> = [];
  if (contacts.mobile?.trim()) {
    norms.push({
      type: PartyContactPointType.MOBILE,
      normalizedValue: normalizePhoneForLookup(contacts.mobile),
    });
  }
  if (contacts.phone?.trim()) {
    norms.push({
      type: PartyContactPointType.PHONE,
      normalizedValue: normalizePhoneForLookup(contacts.phone),
    });
    // Also allow mobile stored as phone and vice versa for operational match.
    norms.push({
      type: PartyContactPointType.MOBILE,
      normalizedValue: normalizePhoneForLookup(contacts.phone),
    });
  }
  if (contacts.email?.trim()) {
    norms.push({
      type: PartyContactPointType.EMAIL,
      normalizedValue: normalizeEmailForLookup(contacts.email),
    });
  }
  if (norms.length === 0) return null;

  const hits = await tx.partyContactPoint.findMany({
    where: {
      companyId,
      status: PartyContactPointStatus.ACTIVE,
      OR: norms.map((n) => ({
        type: n.type,
        normalizedValue: n.normalizedValue,
      })),
      party: {
        companyId,
        type,
        status: { not: PartyStatus.ARCHIVED },
      },
    },
    select: { partyId: true },
    take: 20,
  });

  const unique = [...new Set(hits.map((h) => h.partyId))];
  if (unique.length === 1) return unique[0]!;
  return null; // zero or ambiguous
}

async function countNameCollisions(
  tx: Prisma.TransactionClient,
  companyId: string,
  displayName: string,
): Promise<number> {
  return tx.party.count({
    where: {
      companyId,
      displayName: { equals: displayName, mode: 'insensitive' },
      status: { not: PartyStatus.ARCHIVED },
    },
  });
}

async function recordMap(
  tx: Prisma.TransactionClient,
  companyId: string,
  sourceType: PartyMigrationSourceType,
  sourceId: string,
  partyId: string,
  matchTier: PartyMigrationMatchTier,
  notes: string | null,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await tx.partyMigrationMap.upsert({
    where: {
      companyId_sourceType_sourceId: { companyId, sourceType, sourceId },
    },
    update: { partyId, matchTier, notes },
    create: { companyId, sourceType, sourceId, partyId, matchTier, notes },
  });
}

async function resolveOrCreateParty(
  tx: Prisma.TransactionClient,
  companyId: string,
  input: {
    type: PartyType;
    displayName: string;
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
  },
  stats: Stats,
  dryRun: boolean,
  opts?: {
    /** Reject reuse when Party already has this domain relationship (unique party link). */
    requireNoDomain?: 'SUPPLIER' | 'CUSTOMER';
  },
): Promise<ResolveResult> {
  const displayName = normalizeDisplayName(input.displayName);
  const strong = {
    nationalId: input.nationalId,
    registrationNumber: input.registrationNumber,
    taxId: input.taxId,
  };
  const contacts = {
    mobile: input.mobile,
    phone: input.phone,
    email: input.email,
  };

  const canReuse = async (partyId: string): Promise<boolean> => {
    if (!opts?.requireNoDomain) return true;
    if (opts.requireNoDomain === 'SUPPLIER') {
      const existing = await tx.supplier.findFirst({
        where: { companyId, partyId },
        select: { id: true },
      });
      return !existing;
    }
    if (opts.requireNoDomain === 'CUSTOMER') {
      const existing = await tx.customer.findFirst({
        where: { companyId, partyId },
        select: { id: true },
      });
      return !existing;
    }
    return true;
  };

  if (hasStrongIdentity(strong)) {
    const strongId = await findStrongMatch(tx, companyId, input.type, strong);
    if (strongId && (await canReuse(strongId))) {
      stats.partiesReused += 1;
      stats.strongMatches += 1;
      return { partyId: strongId, tier: PartyMigrationMatchTier.STRONG_IDENTITY, created: false };
    }
  }

  if (hasContactIdentity(contacts)) {
    const contactId = await findContactMatch(tx, companyId, input.type, contacts);
    if (contactId && (await canReuse(contactId))) {
      stats.partiesReused += 1;
      stats.contactMatches += 1;
      return { partyId: contactId, tier: PartyMigrationMatchTier.CONTACT_MATCH, created: false };
    }
    if (contactId && !(await canReuse(contactId))) {
      // Safe match exists but domain link already taken — create separate, flag duplicate.
      stats.potentialDuplicates += 1;
    }
  }

  // Name-only: never merge. Flag potential duplicates when same displayName exists.
  const nameHits = await countNameCollisions(tx, companyId, displayName);
  let tier: PartyMigrationMatchTier = PartyMigrationMatchTier.CREATED_NEW;
  if (nameHits > 0 && !hasStrongIdentity(strong) && !hasContactIdentity(contacts)) {
    tier = PartyMigrationMatchTier.AMBIGUOUS_SEPARATE;
    stats.ambiguousSeparate += 1;
    stats.potentialDuplicates += 1;
  } else if (nameHits > 0) {
    stats.potentialDuplicates += 1;
  }

  stats.partiesCreated += 1;
  if (dryRun) {
    return { partyId: `dry-run-${companyId}-${displayName}`, tier, created: true };
  }

  const partyCode = await allocatePartyCode(tx, companyId);
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
      nationalId: normalizeIdField(input.nationalId),
      registrationNumber: normalizeIdField(input.registrationNumber),
      taxId: normalizeIdField(input.taxId),
    },
  });
  return { partyId: party.id, tier, created: true };
}

async function migrateSuppliers(
  prisma: PrismaClient,
  stats: Stats,
  dryRun: boolean,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.supplier.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: BATCH,
      select: {
        id: true,
        companyId: true,
        partyId: true,
        name: true,
        legalName: true,
        phone: true,
        email: true,
        address: true,
      },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const row of batch) {
      stats.suppliersScanned += 1;
      try {
        if (row.partyId) {
          stats.skippedAlreadyLinked += 1;
          continue;
        }

        if (dryRun) {
          // Dry-run still runs matching against live DB for reporting, without writes.
          await prisma.$transaction(async (tx) => {
            const resolved = await resolveOrCreateParty(
              tx,
              row.companyId,
              {
                type: PartyType.ORGANIZATION,
                displayName: row.name,
                legalName: row.legalName,
                phone: row.phone,
                email: row.email,
              },
              stats,
              true,
              { requireNoDomain: 'SUPPLIER' },
            );
            await ensureRole(tx, row.companyId, resolved.partyId, PartyRoleType.SUPPLIER, stats, true);
            if (row.phone) stats.contactsMigrated += 1;
            if (row.email) stats.contactsMigrated += 1;
            if (row.address) stats.addressesMigrated += 1;
            stats.linksWritten += 1;
          });
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const current = await tx.supplier.findUniqueOrThrow({ where: { id: row.id } });
          if (current.partyId) {
            stats.skippedAlreadyLinked += 1;
            stats.suppliersScanned -= 0;
            return;
          }

          const resolved = await resolveOrCreateParty(
            tx,
            row.companyId,
            {
              type: PartyType.ORGANIZATION,
              displayName: row.name,
              legalName: row.legalName,
              phone: row.phone,
              email: row.email,
            },
            stats,
            false,
            { requireNoDomain: 'SUPPLIER' },
          );

          await ensureRole(tx, row.companyId, resolved.partyId, PartyRoleType.SUPPLIER, stats, false);
          await ensureContact(
            tx,
            row.companyId,
            resolved.partyId,
            PartyContactPointType.PHONE,
            row.phone,
            true,
            stats,
            false,
          );
          await ensureContact(
            tx,
            row.companyId,
            resolved.partyId,
            PartyContactPointType.EMAIL,
            row.email,
            !row.phone,
            stats,
            false,
          );
          if (row.address?.trim()) {
            await ensureAddress(
              tx,
              row.companyId,
              resolved.partyId,
              {
                type: PartyAddressType.GENERAL,
                addressLine1: row.address,
                isPrimary: true,
              },
              stats,
              false,
            );
          }

          await tx.supplier.update({
            where: { id: row.id },
            data: { partyId: resolved.partyId },
          });
          await recordMap(
            tx,
            row.companyId,
            PartyMigrationSourceType.SUPPLIER,
            row.id,
            resolved.partyId,
            resolved.tier,
            resolved.tier === PartyMigrationMatchTier.AMBIGUOUS_SEPARATE
              ? 'Name collision without strong/contact identity; created separate Party'
              : null,
            false,
          );
          stats.linksWritten += 1;
        });
      } catch (err) {
        stats.failures += 1;
        console.error(`[supplier ${row.id}]`, err);
      }
    }
  }
}

async function migrateCustomers(
  prisma: PrismaClient,
  stats: Stats,
  dryRun: boolean,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.customer.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: BATCH,
      include: { addresses: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const row of batch) {
      stats.customersScanned += 1;
      try {
        if (row.partyId) {
          stats.skippedAlreadyLinked += 1;
          continue;
        }

        const partyType =
          row.type === CustomerType.INDIVIDUAL ? PartyType.INDIVIDUAL : PartyType.ORGANIZATION;

        if (dryRun) {
          await prisma.$transaction(async (tx) => {
            const resolved = await resolveOrCreateParty(
              tx,
              row.companyId,
              {
                type: partyType,
                displayName: row.displayName,
                firstName: row.firstName,
                lastName: row.lastName,
                legalName: row.businessName,
                tradeName: row.businessName,
                nationalId: row.nationalId,
                registrationNumber: row.registrationNumber,
                taxId: row.taxId,
                mobile: row.mobile,
                phone: row.phone,
                email: row.email,
              },
              stats,
              true,
              { requireNoDomain: 'CUSTOMER' },
            );
            await ensureRole(tx, row.companyId, resolved.partyId, PartyRoleType.CUSTOMER, stats, true);
            stats.linksWritten += 1;
            stats.contactsMigrated += [row.mobile, row.phone, row.email].filter(Boolean).length;
            stats.addressesMigrated += row.addresses.length;
          });
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const current = await tx.customer.findUniqueOrThrow({ where: { id: row.id } });
          if (current.partyId) {
            stats.skippedAlreadyLinked += 1;
            return;
          }

          const resolved = await resolveOrCreateParty(
            tx,
            row.companyId,
            {
              type: partyType,
              displayName: row.displayName,
              firstName: row.firstName,
              lastName: row.lastName,
              legalName: row.businessName,
              tradeName: row.businessName,
              nationalId: row.nationalId,
              registrationNumber: row.registrationNumber,
              taxId: row.taxId,
              mobile: row.mobile,
              phone: row.phone,
              email: row.email,
            },
            stats,
            false,
            { requireNoDomain: 'CUSTOMER' },
          );

          await ensureRole(tx, row.companyId, resolved.partyId, PartyRoleType.CUSTOMER, stats, false);
          await ensureContact(
            tx,
            row.companyId,
            resolved.partyId,
            PartyContactPointType.MOBILE,
            row.mobile,
            true,
            stats,
            false,
          );
          await ensureContact(
            tx,
            row.companyId,
            resolved.partyId,
            PartyContactPointType.PHONE,
            row.phone,
            !row.mobile,
            stats,
            false,
          );
          await ensureContact(
            tx,
            row.companyId,
            resolved.partyId,
            PartyContactPointType.EMAIL,
            row.email,
            !row.mobile && !row.phone,
            stats,
            false,
          );

          for (const addr of row.addresses) {
            if (!addr.addressLine?.trim()) continue;
            const label = (addr.label ?? '').toUpperCase();
            let type = PartyAddressType.GENERAL;
            if (label.includes('SHIP') || label.includes('ارسال')) type = PartyAddressType.SHIPPING;
            else if (label.includes('BILL') || label.includes('صورتحساب'))
              type = PartyAddressType.BILLING;
            await ensureAddress(
              tx,
              row.companyId,
              resolved.partyId,
              {
                type,
                addressLine1: addr.addressLine,
                city: addr.city,
                province: addr.province,
                postalCode: addr.postalCode,
                label: addr.label,
                recipientName: addr.recipientName,
                recipientPhone: addr.mobile,
                isPrimary: addr.isDefault,
                notes: addr.notes,
              },
              stats,
              false,
            );
          }

          await tx.customer.update({
            where: { id: row.id },
            data: { partyId: resolved.partyId },
          });
          await recordMap(
            tx,
            row.companyId,
            PartyMigrationSourceType.CUSTOMER,
            row.id,
            resolved.partyId,
            resolved.tier,
            resolved.tier === PartyMigrationMatchTier.AMBIGUOUS_SEPARATE
              ? 'Name collision without strong/contact identity; created separate Party'
              : null,
            false,
          );
          stats.linksWritten += 1;
        });
      } catch (err) {
        stats.failures += 1;
        console.error(`[customer ${row.id}]`, err);
      }
    }
  }
}

async function migrateSupplierContacts(
  prisma: PrismaClient,
  stats: Stats,
  dryRun: boolean,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.supplierContact.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: BATCH,
      include: { supplier: { select: { partyId: true, companyId: true } } },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const row of batch) {
      stats.supplierContactsScanned += 1;
      try {
        if (row.contactPartyId) {
          stats.skippedAlreadyLinked += 1;
          continue;
        }
        const orgPartyId = row.supplier.partyId;
        if (!orgPartyId && !dryRun) {
          // Supplier not linked yet — skip; re-run after suppliers.
          continue;
        }

        if (dryRun) {
          stats.partiesCreated += 1;
          stats.linksWritten += 1;
          stats.relationshipsCreated += 1;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const current = await tx.supplierContact.findUniqueOrThrow({ where: { id: row.id } });
          if (current.contactPartyId) {
            stats.skippedAlreadyLinked += 1;
            return;
          }
          const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: row.supplierId } });
          if (!supplier.partyId) return;

          const resolved = await resolveOrCreateParty(
            tx,
            row.companyId,
            {
              type: PartyType.INDIVIDUAL,
              displayName: row.name,
              mobile: row.mobile,
              phone: row.phone,
              email: row.email,
            },
            stats,
            false,
          );

          await ensureRole(tx, row.companyId, resolved.partyId, PartyRoleType.CONTACT, stats, false);
          await ensureContact(
            tx,
            row.companyId,
            resolved.partyId,
            PartyContactPointType.MOBILE,
            row.mobile,
            true,
            stats,
            false,
          );
          await ensureContact(
            tx,
            row.companyId,
            resolved.partyId,
            PartyContactPointType.PHONE,
            row.phone,
            !row.mobile,
            stats,
            false,
          );
          await ensureContact(
            tx,
            row.companyId,
            resolved.partyId,
            PartyContactPointType.EMAIL,
            row.email,
            !row.mobile && !row.phone,
            stats,
            false,
          );

          const relExisting = await tx.partyRelationship.findFirst({
            where: {
              companyId: row.companyId,
              fromPartyId: resolved.partyId,
              toPartyId: supplier.partyId,
              type: PartyRelationshipType.CONTACT_FOR,
              status: PartyRelationshipStatus.ACTIVE,
            },
          });
          if (!relExisting) {
            stats.relationshipsCreated += 1;
            await tx.partyRelationship.create({
              data: {
                companyId: row.companyId,
                fromPartyId: resolved.partyId,
                toPartyId: supplier.partyId,
                type: PartyRelationshipType.CONTACT_FOR,
                status: PartyRelationshipStatus.ACTIVE,
                jobTitle: row.role,
                isPrimary: row.isPrimary,
                notes: row.notes,
              },
            });
          }

          await tx.supplierContact.update({
            where: { id: row.id },
            data: { contactPartyId: resolved.partyId },
          });
          await recordMap(
            tx,
            row.companyId,
            PartyMigrationSourceType.SUPPLIER_CONTACT,
            row.id,
            resolved.partyId,
            resolved.tier,
            `CONTACT_FOR org party ${supplier.partyId}`,
            false,
          );
          stats.linksWritten += 1;
        });
      } catch (err) {
        stats.failures += 1;
        console.error(`[supplierContact ${row.id}]`, err);
      }
    }
  }
}

async function migrateLoans(
  prisma: PrismaClient,
  stats: Stats,
  dryRun: boolean,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.loan.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const row of batch) {
      stats.loansScanned += 1;
      try {
        if (row.lenderPartyId) {
          stats.skippedAlreadyLinked += 1;
          continue;
        }

        // Never merge on lenderName alone — create Party (or reuse via strong/contact if present — names have none).
        if (dryRun) {
          const nameHits = await prisma.party.count({
            where: {
              companyId: row.companyId,
              displayName: { equals: row.lenderName, mode: 'insensitive' },
            },
          });
          stats.partiesCreated += 1;
          if (nameHits > 0) {
            stats.ambiguousSeparate += 1;
            stats.potentialDuplicates += 1;
          }
          stats.linksWritten += 1;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const current = await tx.loan.findUniqueOrThrow({ where: { id: row.id } });
          if (current.lenderPartyId) {
            stats.skippedAlreadyLinked += 1;
            return;
          }

          const resolved = await resolveOrCreateParty(
            tx,
            row.companyId,
            {
              type: PartyType.INDIVIDUAL,
              displayName: row.lenderName,
            },
            stats,
            false,
          );
          await ensureRole(tx, row.companyId, resolved.partyId, PartyRoleType.LENDER, stats, false);
          await tx.loan.update({
            where: { id: row.id },
            data: { lenderPartyId: resolved.partyId },
          });
          await recordMap(
            tx,
            row.companyId,
            PartyMigrationSourceType.LOAN_LENDER,
            row.id,
            resolved.partyId,
            resolved.tier,
            'Lender from lenderName; name-only never auto-merged',
            false,
          );
          stats.linksWritten += 1;
        });
      } catch (err) {
        stats.failures += 1;
        console.error(`[loan ${row.id}]`, err);
      }
    }
  }
}

async function migrateCapital(
  prisma: PrismaClient,
  stats: Stats,
  dryRun: boolean,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.capitalContribution.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const row of batch) {
      stats.capitalScanned += 1;
      try {
        if (row.contributorPartyId) {
          stats.skippedAlreadyLinked += 1;
          continue;
        }

        if (dryRun) {
          stats.partiesCreated += 1;
          stats.linksWritten += 1;
          if (row.contributorType === 'PARTNER') stats.partnersCreated += 1;
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const current = await tx.capitalContribution.findUniqueOrThrow({
            where: { id: row.id },
          });
          if (current.contributorPartyId) {
            stats.skippedAlreadyLinked += 1;
            return;
          }

          const resolved = await resolveOrCreateParty(
            tx,
            row.companyId,
            {
              type: PartyType.INDIVIDUAL,
              displayName: row.contributorName,
            },
            stats,
            false,
          );

          if (row.contributorType === 'PARTNER') {
            await ensureRole(tx, row.companyId, resolved.partyId, PartyRoleType.PARTNER, stats, false);
            const partner = await tx.partner.findUnique({
              where: {
                companyId_partyId: { companyId: row.companyId, partyId: resolved.partyId },
              },
            });
            if (!partner) {
              stats.partnersCreated += 1;
              await tx.partner.create({
                data: {
                  companyId: row.companyId,
                  partyId: resolved.partyId,
                  notes: 'Migrated from capital contribution (ownership % deferred to Phase 10)',
                },
              });
            }
          }

          await tx.capitalContribution.update({
            where: { id: row.id },
            data: { contributorPartyId: resolved.partyId },
          });
          await recordMap(
            tx,
            row.companyId,
            PartyMigrationSourceType.CAPITAL_CONTRIBUTOR,
            row.id,
            resolved.partyId,
            resolved.tier,
            'Contributor from contributorName; name-only never auto-merged',
            false,
          );
          stats.linksWritten += 1;
        });
      } catch (err) {
        stats.failures += 1;
        console.error(`[capital ${row.id}]`, err);
      }
    }
  }
}

function printReport(mode: string, stats: Stats): void {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`Party Migration (${mode})`);
  console.log('═══════════════════════════════════════════');
  console.log(`Suppliers scanned:          ${stats.suppliersScanned}`);
  console.log(`Customers scanned:          ${stats.customersScanned}`);
  console.log(`Supplier contacts scanned:  ${stats.supplierContactsScanned}`);
  console.log(`Loans scanned:              ${stats.loansScanned}`);
  console.log(`Capital contributions:      ${stats.capitalScanned}`);
  console.log('');
  console.log(`Parties created:            ${stats.partiesCreated}`);
  console.log(`Existing Parties reused:    ${stats.partiesReused}`);
  console.log(`Strong identity matches:    ${stats.strongMatches}`);
  console.log(`Contact matches:            ${stats.contactMatches}`);
  console.log(`Ambiguous (separate):       ${stats.ambiguousSeparate}`);
  console.log(`Potential duplicates:       ${stats.potentialDuplicates}`);
  console.log(`Roles added:                ${stats.rolesAdded}`);
  console.log(`Contacts migrated:          ${stats.contactsMigrated}`);
  console.log(`Addresses migrated:         ${stats.addressesMigrated}`);
  console.log(`Relationships created:      ${stats.relationshipsCreated}`);
  console.log(`Partners created:           ${stats.partnersCreated}`);
  console.log(`Domain links written:       ${stats.linksWritten}`);
  console.log(`Already linked (skipped):   ${stats.skippedAlreadyLinked}`);
  console.log(`Failures:                   ${stats.failures}`);
  console.log('═══════════════════════════════════════════');
}

async function main(): Promise<void> {
  const { dryRun, apply } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const stats = emptyStats();

  console.log(`Party domain linking migration — ${dryRun ? 'DRY RUN (no mutations)' : 'APPLY'}`);

  try {
    await migrateSuppliers(prisma, stats, dryRun);
    await migrateCustomers(prisma, stats, dryRun);
    await migrateSupplierContacts(prisma, stats, dryRun);
    await migrateLoans(prisma, stats, dryRun);
    await migrateCapital(prisma, stats, dryRun);
    printReport(dryRun ? 'dry-run' : apply ? 'apply' : 'dry-run', stats);
    if (stats.failures > 0) process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
