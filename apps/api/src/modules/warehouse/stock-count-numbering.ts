import { Prisma } from '@hector/database';

/** COUNT-<6+ digit company sequence>. e.g. COUNT-000001 */
export const STOCK_COUNT_NUMBER_PATTERN = /^COUNT-\d{6,}$/;

export function formatStockCountNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Stock count sequence must be a positive integer.');
  }
  return `COUNT-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next Stock Count sequence value for a company.
 * MUST run inside the same transaction as the StockCount insert.
 */
export async function allocateStockCountSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "stock_count_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "stock_count_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate stock count sequence.');
  }
  return allocated;
}
