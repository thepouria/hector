import { Prisma, SupplierReturnExecutionStatus } from '@hector/database';
import type { SupplierReturnFulfillmentStatus } from './supplier-return-execution.constants';
import type {
  SupplierReturnExecutionProgressView,
  SupplierReturnExecutionSummaryView,
} from './types/supplier-return-execution.types';

type Tx = Prisma.TransactionClient;

/** Sum of quantities on DISPATCHED executions only (excludes DRAFT/CANCELLED). */
export async function getDispatchedQuantitiesByReturnItem(
  tx: Tx,
  companyId: string,
  purchaseReturnId: string,
): Promise<Map<string, number>> {
  const rows = await tx.supplierReturnExecutionItem.groupBy({
    by: ['purchaseReturnItemId'],
    where: {
      companyId,
      execution: {
        purchaseReturnId,
        status: SupplierReturnExecutionStatus.DISPATCHED,
      },
    },
    _sum: { quantity: true },
  });
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.purchaseReturnItemId, row._sum.quantity ?? 0);
  }
  return map;
}

export function computeFulfillmentStatus(
  approvedQuantity: number,
  dispatchedQuantity: number,
): SupplierReturnFulfillmentStatus {
  if (dispatchedQuantity <= 0) {
    return 'NOT_DISPATCHED';
  }
  if (dispatchedQuantity >= approvedQuantity) {
    return 'FULLY_DISPATCHED';
  }
  return 'PARTIALLY_DISPATCHED';
}

export function buildProgressView(
  approvedQuantity: number,
  dispatchedQuantity: number,
): SupplierReturnExecutionProgressView {
  const remainingQuantity = Math.max(0, approvedQuantity - dispatchedQuantity);
  return {
    approvedQuantity,
    dispatchedQuantity,
    remainingQuantity,
    fulfillmentStatus: computeFulfillmentStatus(approvedQuantity, dispatchedQuantity),
  };
}

type ExecutionRow = {
  id: string;
  number: string;
  status: SupplierReturnExecutionStatus;
  warehouseId: string;
  warehouse: { code: string };
  dispatchedAt: Date | null;
  createdAt: Date;
  items: { quantity: number }[];
};

export function toExecutionSummary(row: ExecutionRow): SupplierReturnExecutionSummaryView {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    warehouseId: row.warehouseId,
    warehouseCode: row.warehouse.code,
    itemCount: row.items.length,
    totalQuantity: row.items.reduce((sum, i) => sum + i.quantity, 0),
    dispatchedAt: row.dispatchedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
