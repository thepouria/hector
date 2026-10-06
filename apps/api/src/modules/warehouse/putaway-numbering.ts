import { Prisma } from '@hector/database';

/** PUT-<6+ digit company sequence>. e.g. PUT-000001 */
export const PUTAWAY_NUMBER_PATTERN = /^PUT-\d{6,}$/;

export function formatPutawayNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Putaway sequence must be a positive integer.');
  }
  return `PUT-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next Putaway sequence value for a company.
 * MUST run inside the same transaction as the Putaway insert.
 */
export async function allocatePutawaySequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "putaway_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "putaway_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate putaway sequence.');
  }
  return allocated;
}
