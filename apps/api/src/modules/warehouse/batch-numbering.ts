import { Prisma } from '@hector/database';

/** BAT-<6+ digit company sequence>. e.g. BAT-000001 */
export const BATCH_NUMBER_PATTERN = /^BAT-\d{6,}$/;

export function formatBatchNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Batch sequence must be a positive integer.');
  }
  return `BAT-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next Batch sequence value for a company.
 * MUST run inside the same transaction as the Batch insert.
 */
export async function allocateBatchSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "batch_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "batch_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate batch sequence.');
  }
  return allocated;
}
