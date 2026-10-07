import {
  Prisma,
  SettlementAllocationStatus,
} from '@hector/database';

type Tx = Prisma.TransactionClient;

/**
 * Shared Receipt allocation capacity for Channel Settlement (Phase 6.3).
 * STL: SUM(active SettlementAllocation.paymentAmount where receiptId) <= Receipt.amount
 */
export async function sumReceiptAllocatedAmount(
  tx: Tx,
  companyId: string,
  receiptId: string,
): Promise<Prisma.Decimal> {
  const agg = await tx.settlementAllocation.aggregate({
    where: {
      companyId,
      receiptId,
      status: SettlementAllocationStatus.ACTIVE,
    },
    _sum: { paymentAmount: true },
  });
  return agg._sum.paymentAmount ?? new Prisma.Decimal(0);
}

export async function lockReceiptForAllocation(
  tx: Tx,
  companyId: string,
  receiptId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM receipts
    WHERE id = ${receiptId}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `);
  if (!rows[0]) {
    throw new Error('RECEIPT_LOCK_MISS');
  }
}
