import { Prisma } from '@hector/database';

/** SR-<6+ digit company sequence>. e.g. SR-000001 */
export const SALES_RETURN_NUMBER_PATTERN = /^SR-\d{6,}$/;

export function formatSalesReturnNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Sales return sequence must be a positive integer.');
  }
  return `SR-${String(sequence).padStart(6, '0')}`;
}

export async function allocateSalesReturnSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "sales_return_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "sales_return_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate sales return sequence.');
  }
  return allocated;
}
