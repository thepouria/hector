import { Prisma } from '@hector/database';

/** PTY-<6+ digit company sequence>. e.g. PTY-000001 */
export const PARTY_CODE_PATTERN = /^PTY-\d{6,}$/;

export function formatPartyCode(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Party sequence must be a positive integer.');
  }
  return `PTY-${String(sequence).padStart(6, '0')}`;
}

export async function allocatePartySequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "party_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "party_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate party sequence.');
  }
  return allocated;
}
