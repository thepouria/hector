/**
 * Purchasing → Finance integration contract (Phase 4.1 architecture).
 *
 * Finance consumes Purchasing commercial facts; it never mutates PO truth.
 * Recognition of supplier payable is receipt-based (POSTED Goods Receipt).
 *
 * docs/finance-purchasing-contract.md
 */

export type PurchasingFinancePurchaseType = 'CASH' | 'TERM_CREDIT' | 'FX_CREDIT';

/**
 * Narrow commercial facts Finance may read from Purchasing.
 * Not a Prisma entity dump.
 */
export type PurchasingFinancePurchaseFacts = {
  companyId: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  supplierId: string;
  skuId: string;
  purchaseType: PurchasingFinancePurchaseType;
  /** Original contractual currency of the commercial line / obligation. */
  currency: string;
  unitPrice: string;
  orderedQuantity: number;
  /** FX_CREDIT: foreign obligation principal on PO (when present). */
  obligationAmount?: string | null;
  obligationCurrency?: string | null;
  referenceFxRate?: string | null;
  referenceFxBaseCurrency?: string | null;
  referenceFxQuoteCurrency?: string | null;
  dueDate?: string | null;
  netDays?: number | null;
};

/**
 * Warehouse evidence Finance uses together with Purchasing facts.
 * Accepted received quantity is Warehouse authority.
 */
export type PurchasingFinanceReceiptEvidence = {
  companyId: string;
  goodsReceiptId: string;
  goodsReceiptItemId: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  skuId: string;
  /** POSTED only — DRAFT never recognizes liability. */
  goodsReceiptStatus: 'POSTED';
  acceptedReceivedQuantity: number;
};

/**
 * Incremental payable recognition hint (architecture only — no table yet).
 *
 * recognizedQuantity for a PO item =
 *   SUM(acceptedReceivedQuantity on POSTED GRNs for that item)
 *   (never orderedQuantity alone; never exceed ordered − closedUnfulfilled)
 */
export type SupplierPayableRecognitionHint = {
  companyId: string;
  supplierId: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  skuId: string;
  currency: string;
  unitPrice: string;
  recognizedQuantity: number;
  referenceFxRate?: string | null;
};

export const PURCHASING_FINANCE_GUARDS = {
  financeMustNotMutatePurchaseOrder: true,
  financeMustNotMutatePurchaseOrderItem: true,
  financeMustNotDuplicateSupplierMaster: true,
  draftPurchaseOrderCreatesPayable: false,
  payableCurrencyFollowsPurchaseCurrency: true,
} as const;
