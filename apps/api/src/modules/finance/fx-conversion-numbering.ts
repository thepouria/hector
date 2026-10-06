import { Prisma } from '@hector/database';

/** FXC-<6+ digit company sequence>. e.g. FXC-000001 */
export const FX_CONVERSION_NUMBER_PATTERN = /^FXC-\d{6,}$/;

export function formatFxConversionNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('FX conversion sequence must be a positive integer.');
  }
  return `FXC-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next FX conversion sequence for a company.
 * MUST run inside the same transaction as the FxConversion insert.
 */
export async function allocateFxConversionSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "fx_conversion_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "fx_conversion_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate FX conversion sequence.');
  }
  return allocated;
}
