import { Prisma } from '@hector/database';

/** GRN-<UTC year>-<6+ digit company sequence>. e.g. GRN-2026-000001 */
export const GOODS_RECEIPT_NUMBER_PATTERN = /^GRN-\d{4}-\d{6,}$/;

export function formatGoodsReceiptNumber(referenceDate: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Goods receipt sequence must be a positive integer.');
  }
  const year = referenceDate.getUTCFullYear();
  return `GRN-${String(year).padStart(4, '0')}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next GRN sequence value for a company.
 * MUST run inside the same transaction as the GRN insert.
 */
export async function allocateGoodsReceiptSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "goods_receipt_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "goods_receipt_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate goods receipt sequence.');
  }
  return allocated;
}
