import { Prisma } from '@hector/database';

/** SO-<6+ digit company sequence>. e.g. SO-000001 */
export const SALES_ORDER_NUMBER_PATTERN = /^SO-\d{6,}$/;

export function formatSalesOrderNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Sales order sequence must be a positive integer.');
  }
  return `SO-${String(sequence).padStart(6, '0')}`;
}

export async function allocateSalesOrderSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "sales_order_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "sales_order_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate sales order sequence.');
  }
  return allocated;
}
