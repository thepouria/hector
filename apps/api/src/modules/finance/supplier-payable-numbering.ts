import { Prisma } from '@hector/database';

export function formatSupplierPayableNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Supplier payable sequence must be a positive integer.');
  }
  return `AP-${String(sequence).padStart(6, '0')}`;
}

export async function allocateSupplierPayableSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "supplier_payable_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "supplier_payable_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate supplier payable sequence.');
  }
  return allocated;
}

export function formatSupplierCreditNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError('Supplier credit sequence must be a positive integer.');
  }
  return `SC-${String(sequence).padStart(6, '0')}`;
}

export async function allocateSupplierCreditSequence(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ allocated: number }>>(Prisma.sql`
    INSERT INTO "supplier_credit_sequences" ("company_id", "next_value")
    VALUES (${companyId}::uuid, 2)
    ON CONFLICT ("company_id")
    DO UPDATE SET "next_value" = "supplier_credit_sequences"."next_value" + 1
    RETURNING "next_value" - 1 AS "allocated"
  `);
  const allocated = rows[0]?.allocated;
  if (typeof allocated !== 'number') {
    throw new Error('Failed to allocate supplier credit sequence.');
  }
  return allocated;
}
