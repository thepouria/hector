import { Prisma } from '@hector/database';

/** FAT-<6+ digit company sequence>. e.g. FAT-000001 */
export const ACCOUNT_TRANSFER_NUMBER_PATTERN = /^FAT-\d{6,}$/;

export function formatAccountTransferNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Account transfer sequence must be a positive integer.');
  }
  return `FAT-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next Financial Account Transfer sequence for a company.
 * MUST run inside the same transaction as the FinancialAccountTransfer insert.
 */
export async function allocateAccountTransferSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "financial_account_transfer_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "financial_account_transfer_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate account transfer sequence.');
  }
  return allocated;
}
