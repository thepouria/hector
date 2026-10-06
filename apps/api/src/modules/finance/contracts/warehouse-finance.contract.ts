/**
 * Warehouse → Finance integration contract (Phase 4.1 architecture).
 *
 * Finance may consume physical/valuation facts. Finance never mutates:
 * InventoryMovement, StockBalance, FIFO layers, or layer consumptions.
 *
 * docs/finance-warehouse-contract.md
 */

export type WarehouseFinanceGoodsReceivedFact = {
  companyId: string;
  goodsReceiptId: string;
  purchaseOrderId: string | null;
  postedAt: string;
  items: Array<{
    goodsReceiptItemId: string;
    purchaseOrderItemId: string | null;
    skuId: string;
    acceptedReceivedQuantity: number;
  }>;
};

export type WarehouseFinanceSupplierReturnDispatchedFact = {
  companyId: string;
  supplierReturnExecutionId: string;
  purchaseReturnId: string;
  dispatchedAt: string;
  items: Array<{
    purchaseReturnItemId: string;
    skuId: string;
    quantity: number;
  }>;
};

/**
 * Read-only valuation / cost provenance peek for future journal policy.
 * Not COGS. Profit Engine classifies economic meaning later.
 */
export type WarehouseFinanceValuationPeek = {
  companyId: string;
  skuId: string;
  warehouseId?: string;
  knownInventoryValueBase?: string | null;
  unvaluedQuantity?: number;
};

export const WAREHOUSE_FINANCE_GUARDS = {
  financeMustNotMutateInventoryMovement: true,
  financeMustNotMutateStockBalance: true,
  financeMustNotMutateFifoLayers: true,
  financeMustNotMutateLayerConsumptions: true,
  fifoConsumptionIsNotAutomaticallyCogs: true,
  inventoryPurchaseIsNotAutomaticallyExpense: true,
} as const;
