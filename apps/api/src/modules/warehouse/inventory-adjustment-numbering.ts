import { Prisma } from '@hector/database';

/** ADJ-<6+ digit company sequence>. e.g. ADJ-000001 */
export const INVENTORY_ADJUSTMENT_NUMBER_PATTERN = /^ADJ-\d{6,}$/;

export function formatInventoryAdjustmentNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Inventory adjustment sequence must be a positive integer.');
  }
  return `ADJ-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next Inventory Adjustment sequence value for a company.
 * MUST run inside the same transaction as the InventoryAdjustment insert.
 */
export async function allocateInventoryAdjustmentSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "inventory_adjustment_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "inventory_adjustment_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate inventory adjustment sequence.');
  }
  return allocated;
}
