import { Prisma } from '@hector/database';

export const SETTLEMENT_CODE_PREFIX = 'STL';
export const SETTLEMENT_CODE_PATTERN = /^STL-\d{6,}$/;

export function formatSettlementNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Settlement sequence must be a positive integer.');
  }
  return `${SETTLEMENT_CODE_PREFIX}-${String(sequence).padStart(6, '0')}`;
}

export async function allocateSettlementSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "settlement_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "settlement_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate settlement sequence.');
  }
  return allocated;
}
