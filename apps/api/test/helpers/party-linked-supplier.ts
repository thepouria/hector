import {
  PartyRoleStatus,
  PartyRoleType,
  PartyStatus,
  PartyType,
  PurchasingLifecycleStatus,
  type PrismaClient,
} from '@hector/database';

/**
 * Create a Supplier already linked to a Party (Phase 5.5.2).
 * Prefer this over raw `supplier.create` in e2e fixtures.
 */
export async function createPartyLinkedSupplier(
  client: PrismaClient,
  input: {
    companyId: string;
    name: string;
    status?: PurchasingLifecycleStatus | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
    phone?: string | null;
    email?: string | null;
    code?: string | null;
  },
) {
  const seqRows = await client.$queryRaw<Array<{ allocated: number }>>`
    INSERT INTO "party_sequences" ("company_id", "next_value")
    VALUES (${input.companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "party_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `;
  const allocated = seqRows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate party sequence for e2e supplier.');
  }
  const partyCode = `PTY-${String(allocated).padStart(6, '0')}`;

  const party = await client.party.create({
    data: {
      companyId: input.companyId,
      partyCode,
      type: PartyType.ORGANIZATION,
      status: PartyStatus.ACTIVE,
      displayName: input.name,
    },
  });

  await client.partyRole.create({
    data: {
      companyId: input.companyId,
      partyId: party.id,
      roleType: PartyRoleType.SUPPLIER,
      status: PartyRoleStatus.ACTIVE,
    },
  });

  return client.supplier.create({
    data: {
      companyId: input.companyId,
      partyId: party.id,
      name: input.name,
      status: (input.status as PurchasingLifecycleStatus | undefined) ?? PurchasingLifecycleStatus.ACTIVE,
      phone: input.phone ?? null,
      email: input.email ?? null,
      code: input.code ?? null,
    },
  });
}
