import { Prisma } from '@hector/database';

/** PR-<UTC year>-<6+ digit company sequence>. e.g. PR-2026-000001 */
export const PURCHASE_RETURN_NUMBER_PATTERN = /^PR-\d{4}-\d{6,}$/;

export function formatPurchaseReturnNumber(at: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Purchase return sequence must be a positive integer.');
  }
  const year = at.getUTCFullYear();
  return `PR-${String(year).padStart(4, '0')}-${String(sequence).padStart(6, '0')}`;
}

export async function allocatePurchaseReturnSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "purchase_return_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "purchase_return_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate purchase return sequence.');
  }
  return allocated;
}
