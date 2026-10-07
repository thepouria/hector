import { Prisma } from '@hector/database';

export const CHANNEL_SETTLEMENT_CODE_PREFIX = 'CHS';
export const CHANNEL_SETTLEMENT_CODE_PATTERN = /^CHS-\d{6,}$/;

export function formatChannelSettlementNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Channel settlement sequence must be a positive integer.');
  }
  return `${CHANNEL_SETTLEMENT_CODE_PREFIX}-${String(sequence).padStart(6, '0')}`;
}

export async function allocateChannelSettlementSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "channel_settlement_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "channel_settlement_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate channel settlement sequence.');
  }
  return allocated;
}
