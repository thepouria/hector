import { Prisma } from '@hector/database';

/** TRF-<6+ digit company sequence>. e.g. TRF-000001 */
export const STOCK_TRANSFER_NUMBER_PATTERN = /^TRF-\d{6,}$/;

export function formatStockTransferNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Stock transfer sequence must be a positive integer.');
  }
  return `TRF-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next Stock Transfer sequence value for a company.
 * MUST run inside the same transaction as the StockTransfer insert.
 */
export async function allocateStockTransferSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "stock_transfer_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "stock_transfer_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate stock transfer sequence.');
  }
  return allocated;
}
