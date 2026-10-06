import { Prisma } from '@hector/database';

/** PO-<UTC year of orderDate>-<6+ digit company sequence>. e.g. PO-2026-000001 */
export const PURCHASE_ORDER_NUMBER_PATTERN = /^PO-\d{4}-\d{6,}$/;

export function formatPurchaseOrderNumber(orderDate: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Purchase order sequence must be a positive integer.');
  }
  const year = orderDate.getUTCFullYear();
  return `PO-${String(year).padStart(4, '0')}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next sequence value for a company.
 * MUST run inside the same transaction as the PO insert so a failed create rolls the counter back
 * (gapless) and concurrent creates serialize on the sequence row lock.
 *
 * First call inserts next_value = 2 and returns 1; later calls increment and return the previous value.
 */
export async function allocatePurchaseOrderSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "purchase_order_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "purchase_order_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate purchase order sequence.');
  }
  return allocated;
}
