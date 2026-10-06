import { Prisma } from '@hector/database';

/** ISS-<6+ digit company sequence>. e.g. ISS-000001 */
export const STOCK_ISSUE_NUMBER_PATTERN = /^ISS-\d{6,}$/;

export function formatStockIssueNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Stock issue sequence must be a positive integer.');
  }
  return `ISS-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next Stock Issue sequence value for a company.
 * MUST run inside the same transaction as the StockIssue insert.
 */
export async function allocateStockIssueSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "stock_issue_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "stock_issue_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate stock issue sequence.');
  }
  return allocated;
}
