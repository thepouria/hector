import {
  ExpensePaymentAllocationStatus,
  Prisma,
  PurchaseCostPaymentAllocationStatus,
  SettlementAllocationStatus,
  SupplierPaymentAllocationStatus,
} from '@hector/database';

type Tx = Prisma.TransactionClient;

/**
 * Shared Payment allocation capacity across all consumers:
 * - Phase 6.1/6.2 SettlementAllocation.paymentAmount (ACTIVE)
 * - Phase 4.9 SupplierPaymentAllocation.paymentAmountApplied (POSTED)
 * - ExpensePaymentAllocation (ACTIVE)
 * - PurchaseCostPaymentAllocation (ACTIVE)
 *
 * STL-007: SUM(active payment-currency allocations) <= Payment.amount
 */
export async function sumPaymentAllocatedAmount(
  tx: Tx,
  companyId: string,
  paymentId: string,
): Promise<Prisma.Decimal> {
  const [core, supplier, expense, purchaseCost] = await Promise.all([
    tx.settlementAllocation.aggregate({
      where: {
        companyId,
        paymentId,
        status: SettlementAllocationStatus.ACTIVE,
      },
      _sum: { paymentAmount: true },
    }),
    tx.supplierPaymentAllocation.aggregate({
      where: {
        companyId,
        paymentId,
        status: SupplierPaymentAllocationStatus.POSTED,
      },
      _sum: { paymentAmountApplied: true },
    }),
    tx.expensePaymentAllocation.aggregate({
      where: {
        companyId,
        paymentId,
        status: ExpensePaymentAllocationStatus.ACTIVE,
      },
      _sum: { amount: true },
    }),
    tx.purchaseCostPaymentAllocation.aggregate({
      where: {
        companyId,
        paymentId,
        status: PurchaseCostPaymentAllocationStatus.ACTIVE,
      },
      _sum: { amount: true },
    }),
  ]);

  return (core._sum.paymentAmount ?? new Prisma.Decimal(0))
    .plus(supplier._sum.paymentAmountApplied ?? new Prisma.Decimal(0))
    .plus(expense._sum.amount ?? new Prisma.Decimal(0))
    .plus(purchaseCost._sum.amount ?? new Prisma.Decimal(0));
}

export async function lockPaymentForAllocation(
  tx: Tx,
  companyId: string,
  paymentId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM payments
    WHERE id = ${paymentId}::uuid AND company_id = ${companyId}::uuid
    FOR UPDATE
  `);
  if (!rows[0]) {
    throw new Error('PAYMENT_LOCK_MISS');
  }
}
