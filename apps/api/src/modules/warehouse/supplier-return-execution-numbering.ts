import { Prisma } from '@hector/database';

/** SRE-<6+ digit company sequence>. e.g. SRE-000001 */
export const SUPPLIER_RETURN_EXECUTION_NUMBER_PATTERN = /^SRE-\d{6,}$/;

export function formatSupplierReturnExecutionNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Supplier return execution sequence must be a positive integer.');
  }
  return `SRE-${String(sequence).padStart(6, '0')}`;
}

/**
 * Atomically allocates the next Supplier Return Execution sequence value for a company.
 * MUST run inside the same transaction as the SupplierReturnExecution insert.
 */
export async function allocateSupplierReturnExecutionSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "supplier_return_execution_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "supplier_return_execution_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate supplier return execution sequence.');
  }
  return allocated;
}
