import { Prisma } from '@hector/database';

/** CR-<6+ digit company sequence>. e.g. CR-000001 */
export const CUSTOMER_RECEIVABLE_NUMBER_PATTERN = /^CR-\d{6,}$/;

export function formatCustomerReceivableNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Customer receivable sequence must be a positive integer.');
  }
  return `CR-${String(sequence).padStart(6, '0')}`;
}

export async function allocateCustomerReceivableSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "customer_receivable_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "customer_receivable_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate customer receivable sequence.');
  }
  return allocated;
}
