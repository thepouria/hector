import type { CatalogLifecycleStatus } from '@/types/catalog';

export type PurchasingLifecycleStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type SupplierPrimaryContact = {
  id: string;
  name: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
};

export type SupplierListItem = {
  id: string;
  companyId: string;
  name: string;
  legalName: string | null;
  code: string | null;
  status: PurchasingLifecycleStatus;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  primaryContact: SupplierPrimaryContact | null;
};

export type SupplierContact = {
  id: string;
  companyId: string;
  supplierId: string;
  name: string;
  role: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type SupplierDetail = SupplierListItem & {
  contacts: SupplierContact[];
};

export type SupplierNoteAuthor = {
  id: string;
  displayName: string;
};

export type SupplierNote = {
  id: string;
  companyId: string;
  supplierId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  author: SupplierNoteAuthor;
};

export type SupplierOption = {
  id: string;
  name: string;
  code: string | null;
  status: PurchasingLifecycleStatus;
};

export type OfferCurrency = 'IRR' | 'USD';

export type PurchaseCommercialType = 'CASH' | 'TERM_CREDIT' | 'FX_CREDIT';

export type PaymentTermType = 'IMMEDIATE' | 'NET_DAYS' | 'FIXED_DATE';

export type SupplierOfferExpiryState = 'ARCHIVED' | 'EXPIRED' | 'CURRENT' | 'NO_EXPIRY';

export type SupplierOfferValidityFilter =
  | 'CURRENT'
  | 'EXPIRED'
  | 'NO_EXPIRY'
  | 'ARCHIVED'
  | 'ACTIVE';

export type SupplierOfferSortField = 'quotedAt' | 'unitPrice' | 'createdAt' | 'validUntil';

export type SupplierOfferSkuRef = {
  id: string;
  code: string;
  name: string | null;
  status: CatalogLifecycleStatus;
  product: { id: string; name: string; code: string };
};

export type SupplierOfferSupplierRef = {
  id: string;
  name: string;
  code: string | null;
  status: PurchasingLifecycleStatus;
};

export type SupplierOfferContactRef = {
  id: string;
  name: string;
  role: string | null;
};

export type SupplierOfferAuthorRef = {
  id: string;
  displayName: string;
};

/** API unitPrice for IRR is rials (decimal string); UI shows Toman (÷10). */
export type SupplierOffer = {
  id: string;
  companyId: string;
  supplierId: string;
  skuId: string;
  supplierContactId: string | null;
  unitPrice: string;
  currency: OfferCurrency;
  purchaseType: PurchaseCommercialType | null;
  paymentTermType: PaymentTermType | null;
  netDays: number | null;
  quotedQuantity: number | null;
  minimumQuantity: number | null;
  availableQuantity: number | null;
  referenceFxRate: string | null;
  referenceFxBaseCurrency: OfferCurrency | null;
  referenceFxQuoteCurrency: OfferCurrency | null;
  quotedAt: string;
  validUntil: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  expiryState: SupplierOfferExpiryState;
  supplier: SupplierOfferSupplierRef;
  sku: SupplierOfferSkuRef;
  supplierContact: SupplierOfferContactRef | null;
  createdBy: SupplierOfferAuthorRef;
};

// --- Purchase Orders (Phase 2.4) ---

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'APPROVED'
  | 'ORDERED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED';

export type PurchaseOrderLifecycleAction =
  | 'EDIT'
  | 'APPROVE'
  | 'ORDER'
  | 'CANCEL'
  | 'ADD_COST';

export type PurchaseOrderSortField = 'orderDate' | 'createdAt' | 'number' | 'total';

export type PurchaseOrderUserRef = {
  id: string;
  displayName: string;
};

export type PurchaseOrderSupplierRef = {
  id: string;
  name: string;
  code: string | null;
  status: PurchasingLifecycleStatus;
};

export type PurchaseOrderItem = {
  id: string;
  purchaseOrderId: string;
  skuId: string;
  quantity: number;
  /** Purchasing short-close projection — not received / not returned. */
  closedUnfulfilledQuantity: number;
  unitPrice: string;
  lineSubtotal: string;
  supplierOfferId: string | null;
  notes: string | null;
  skuCodeSnapshot: string | null;
  productNameSnapshot: string | null;
  variantLabelSnapshot: string | null;
  productIdSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  sku: {
    id: string;
    code: string;
    name: string | null;
    status: CatalogLifecycleStatus;
    product: { id: string; name: string; code: string | null };
  };
  supplierOffer: {
    id: string;
    unitPrice: string;
    currency: OfferCurrency;
    quotedAt: string;
    archivedAt: string | null;
  } | null;
};

export type PurchaseTermBasis = 'ORDER_DATE';

export type PurchaseDueStatus =
  | 'NO_DUE_DATE'
  | 'UPCOMING'
  | 'DUE_SOON'
  | 'DUE_TODAY'
  | 'OVERDUE';

export type PurchaseOrderListItem = {
  id: string;
  companyId: string;
  number: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierContactId: string | null;
  currency: OfferCurrency;
  purchaseType: PurchaseCommercialType | null;
  paymentTermType: PaymentTermType | null;
  netDays: number | null;
  termBasis: PurchaseTermBasis | null;
  dueDate: string | null;
  dueStatus: PurchaseDueStatus;
  paymentTermsNote: string | null;
  obligationAmount: string | null;
  obligationCurrency: OfferCurrency | null;
  referenceFxRate: string | null;
  referenceFxBaseCurrency: OfferCurrency | null;
  referenceFxQuoteCurrency: OfferCurrency | null;
  referenceFxRateAt: string | null;
  /** Server-derived analysis (not a rial liability). */
  referenceLocalValuation: string | null;
  referenceLocalValuationCurrency: OfferCurrency | null;
  settlementBasis: 'FOREIGN_OBLIGATION' | null;
  orderDate: string;
  expectedAt: string | null;
  supplierOrderReference: string | null;
  notes: string | null;
  cancellationReason: string | null;
  availableActions: PurchaseOrderLifecycleAction[];
  subtotal: string;
  total: string;
  supplierNameSnapshot: string | null;
  supplierCodeSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  orderedAt: string | null;
  cancelledAt: string | null;
  version: number;
  supplier: PurchaseOrderSupplierRef;
  createdBy: PurchaseOrderUserRef;
  itemCount: number;
};

export type PurchaseCostType =
  | 'COURIER'
  | 'FREIGHT'
  | 'PURCHASE_FEE'
  | 'TRANSFER_FEE'
  | 'PACKAGING'
  | 'CUSTOMS'
  | 'OTHER';

export type PurchaseCostStatus = 'ACTIVE' | 'VOIDED';

export type PurchaseCostAllocationMethod =
  | 'UNALLOCATED'
  | 'BY_QUANTITY'
  | 'BY_VALUE'
  | 'MANUAL';

export type PurchaseOrderCost = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  type: PurchaseCostType;
  status: PurchaseCostStatus;
  description: string | null;
  amount: string;
  currency: OfferCurrency;
  costDate: string;
  payeeName: string | null;
  reference: string | null;
  notes: string | null;
  allocationMethod: PurchaseCostAllocationMethod;
  supplierId: string | null;
  supplier: { id: string; name: string; code: string | null } | null;
  createdBy: PurchaseOrderUserRef;
  voidedBy: PurchaseOrderUserRef | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseCostTotalsByCurrency = Array<{
  currency: OfferCurrency;
  amount: string;
}>;

export type PurchaseOrder = PurchaseOrderListItem & {
  supplierContact: { id: string; name: string; role: string | null } | null;
  approvedBy: PurchaseOrderUserRef | null;
  orderedBy: PurchaseOrderUserRef | null;
  cancelledBy: PurchaseOrderUserRef | null;
  items: PurchaseOrderItem[];
  purchaseCosts?: PurchaseOrderCost[];
  purchaseCostTotalsByCurrency?: PurchaseCostTotalsByCurrency;
  referenceAcquisitionTotal?: { amount: string; currency: OfferCurrency } | null;
};

export type CreatePurchaseOrderCostBody = {
  type: PurchaseCostType;
  amount: string;
  currency: OfferCurrency;
  description?: string;
  costDate?: string;
  payeeName?: string;
  reference?: string;
  notes?: string;
  allocationMethod?: PurchaseCostAllocationMethod;
  supplierId?: string;
};

export type UpdatePurchaseOrderCostBody = {
  type?: PurchaseCostType;
  amount?: string;
  currency?: OfferCurrency;
  description?: string | null;
  costDate?: string;
  payeeName?: string | null;
  reference?: string | null;
  notes?: string | null;
  allocationMethod?: PurchaseCostAllocationMethod;
  supplierId?: string | null;
};

export type CreatePurchaseOrderBody = {
  supplierId: string;
  supplierContactId?: string;
  currency: OfferCurrency;
  purchaseType?: PurchaseCommercialType;
  paymentTermType?: PaymentTermType;
  netDays?: number;
  dueDate?: string;
  paymentTermsNote?: string;
  obligationAmount?: string;
  obligationCurrency?: OfferCurrency;
  referenceFxRate?: string;
  referenceFxBaseCurrency?: OfferCurrency;
  referenceFxQuoteCurrency?: OfferCurrency;
  referenceFxRateAt?: string;
  orderDate?: string;
  expectedAt?: string;
  notes?: string;
  items: Array<{
    skuId: string;
    quantity: number;
    unitPrice: string;
    supplierOfferId?: string;
    notes?: string;
  }>;
};

export type UpdatePurchaseOrderBody = {
  supplierId?: string;
  supplierContactId?: string | null;
  currency?: OfferCurrency;
  purchaseType?: PurchaseCommercialType | null;
  paymentTermType?: PaymentTermType | null;
  netDays?: number | null;
  dueDate?: string | null;
  paymentTermsNote?: string | null;
  obligationAmount?: string | null;
  obligationCurrency?: OfferCurrency | null;
  referenceFxRate?: string | null;
  referenceFxBaseCurrency?: OfferCurrency | null;
  referenceFxQuoteCurrency?: OfferCurrency | null;
  referenceFxRateAt?: string | null;
  orderDate?: string;
  expectedAt?: string | null;
  notes?: string | null;
  expectedVersion?: number;
};

export type AddPurchaseOrderItemBody = CreatePurchaseOrderBody['items'][number];

export type UpdatePurchaseOrderItemBody = {
  quantity?: number;
  unitPrice?: string;
  supplierOfferId?: string | null;
  notes?: string | null;
};

export type PurchaseOrderTransitionBody = {
  expectedVersion?: number;
};

export type CancelPurchaseOrderBody = PurchaseOrderTransitionBody & {
  reason?: string;
};

export type PurchaseCorrectionType =
  | 'DATA_ENTRY_ERROR'
  | 'QUANTITY_CORRECTION'
  | 'PRICE_CORRECTION'
  | 'COMMERCIAL_TERM_CORRECTION'
  | 'SUPPLIER_CORRECTION'
  | 'OTHER';

export type PurchaseOrderCorrection = {
  id: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string | null;
  type: PurchaseCorrectionType;
  status: 'APPLIED';
  reason: string;
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  appliedBy: { id: string; displayName: string };
  appliedAt: string;
};

export type PurchaseDiscrepancyType =
  | 'SHORT_SHIPMENT'
  | 'OVER_SHIPMENT'
  | 'DAMAGED'
  | 'WRONG_ITEM'
  | 'MISSING'
  | 'OTHER';

export type PurchaseDiscrepancySource = 'BEFORE_RECEIPT' | 'AT_RECEIPT' | 'AFTER_RECEIPT';

export type PurchaseDiscrepancyStatus = 'OPEN' | 'RESOLVED' | 'SHORT_CLOSED';

export type PurchaseDiscrepancy = {
  id: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  type: PurchaseDiscrepancyType;
  source: PurchaseDiscrepancySource;
  status: PurchaseDiscrepancyStatus;
  quantity: number;
  reason: string;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
  createdBy: { id: string; displayName: string };
  resolvedBy: { id: string; displayName: string } | null;
};

export type PurchasingSummary = {
  supplierCount: number;
  activeSupplierCount: number;
  currentOfferCount: number;
  draftPOCount: number;
  approvedPOCount: number;
  orderedPOCount: number;
  partiallyReceivedPOCount: number;
  receivedPOCount: number;
  cancelledPOCount: number;
  dueDatePassedCount: number;
  upcomingDueCount: number;
  draftReturnCount: number;
  approvedReturnCount: number;
  financeKpis: 'DEFERRED_TO_FINANCE';
  inventoryKpis: 'DEFERRED_TO_WAREHOUSE';
};

export type DashboardMoneyByCurrency = {
  currency: OfferCurrency;
  amount: string;
  poCount: number;
};

export type DashboardAmountRef = {
  amount: string;
  currency: OfferCurrency;
  kind: 'FOREIGN_OBLIGATION' | 'MERCHANDISE_SUBTOTAL';
};

export type PurchasingDashboard = {
  meta: {
    range: {
      preset: string;
      from: string;
      to: string;
      dayCount: number;
      granularity: 'day' | 'week' | 'month';
      previousFrom: string;
      previousTo: string;
      dateBasis: 'orderDate';
    };
    filters: {
      supplierId: string | null;
      purchaseType: PurchaseCommercialType | null;
      status: PurchaseOrderStatus | null;
      currency: OfferCurrency | null;
    };
    definitions: Record<string, string>;
    financeKpis: 'DEFERRED_TO_FINANCE';
    inventoryKpis: 'DEFERRED_TO_WAREHOUSE';
    operationalSectionsScope: 'current_snapshot';
    analyticsSectionsScope: 'selected_period_orderDate';
  };
  kpis: {
    openPurchaseCount: number;
    draftPurchaseCount: number;
    periodCommittedPoCount: number;
    previousPeriodCommittedPoCount: number;
    localMerchandiseByCurrency: DashboardMoneyByCurrency[];
    localPurchaseCostsByCurrency: DashboardMoneyByCurrency[];
    localCommercialValueByCurrency: DashboardMoneyByCurrency[];
    previousLocalCommercialValueByCurrency: DashboardMoneyByCurrency[];
    foreignObligationsByCurrency: DashboardMoneyByCurrency[];
    previousForeignObligationsByCurrency: DashboardMoneyByCurrency[];
    fxReferenceLocalValueByCurrency: Array<{
      currency: OfferCurrency;
      amount: string;
      note: string;
    }>;
    upcomingDueCount: number;
    dueDatePassedCount: number;
    activeSupplierCountInPeriod: number;
  };
  attention: Array<{
    kind: string;
    label: string;
    purchaseOrderId?: string;
    purchaseReturnId?: string;
    number: string;
    supplierName: string;
    at: string | null;
  }>;
  openPurchases: Array<{
    id: string;
    number: string;
    status: PurchaseOrderStatus;
    purchaseType: PurchaseCommercialType | null;
    orderDate: string;
    dueDate: string | null;
    daysRemaining: number | null;
    supplier: { id: string; name: string; code: string | null };
    amount: DashboardAmountRef;
  }>;
  upcomingDue: {
    TODAY: Array<DashboardDueRow>;
    D1_7: Array<DashboardDueRow>;
    D8_30: Array<DashboardDueRow>;
    PAST: Array<DashboardDueRow>;
  };
  unfulfilled: Array<{
    id: string;
    number: string;
    status: PurchaseOrderStatus;
    orderDate: string;
    orderedAt: string | null;
    daysSinceOrder: number;
    itemCount: number;
    supplier: { id: string; name: string; code: string | null };
    phase2Note: string;
  }>;
  trend: Array<{
    bucket: string;
    poCount: number;
    localMerchandiseByCurrency: Array<{ currency: string; amount: string }>;
    foreignObligationByCurrency: Array<{ currency: string; amount: string }>;
  }>;
  supplierBreakdown: Array<{
    supplierId: string;
    supplierName: string;
    supplierCode: string | null;
    poCount: number;
    localMerchandiseByCurrency: Array<{ currency: string; amount: string }>;
    foreignObligationByCurrency: Array<{ currency: string; amount: string }>;
    localIrrSharePercent: string | null;
  }>;
  purchaseTypeBreakdown: Array<{
    purchaseType: PurchaseCommercialType | null;
    poCount: number;
    merchandiseSubtotal: string;
  }>;
  currencyBreakdown: Array<{
    currency: OfferCurrency;
    poCount: number;
    merchandiseSubtotal: string;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    createdAt: string;
    actor: { id: string; displayName: string } | null;
  }>;
};

export type DashboardDueRow = {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  purchaseType: PurchaseCommercialType | null;
  dueDate: string;
  daysRemaining: number;
  daysRemainingLabel: string;
  supplier: { id: string; name: string; code: string | null };
  referenceAmount: DashboardAmountRef;
};

export type PurchaseReturnStatus = 'DRAFT' | 'APPROVED' | 'CANCELLED';
export type PurchaseReturnReason =
  | 'DAMAGED'
  | 'DEFECTIVE'
  | 'WRONG_ITEM'
  | 'OVER_SHIPMENT'
  | 'QUALITY_ISSUE'
  | 'EXPIRED'
  | 'SUPPLIER_AGREEMENT'
  | 'OTHER';
export type PurchaseReturnResolution =
  | 'REFUND'
  | 'SUPPLIER_CREDIT'
  | 'REPLACEMENT'
  | 'PAYABLE_REDUCTION'
  | 'UNKNOWN';

export type PurchaseReturnItem = {
  id: string;
  purchaseReturnId: string;
  purchaseOrderItemId: string | null;
  skuId: string;
  quantity: number;
  reason: PurchaseReturnReason | null;
  notes: string | null;
  sku: {
    id: string;
    code: string;
    name: string | null;
    product: { id: string; name: string; code: string | null };
  };
};

export type PurchaseReturn = {
  id: string;
  companyId: string;
  number: string;
  supplierId: string;
  purchaseOrderId: string | null;
  status: PurchaseReturnStatus;
  reason: PurchaseReturnReason;
  expectedResolution: PurchaseReturnResolution;
  notes: string | null;
  version: number;
  createdAt: string;
  approvedAt: string | null;
  cancelledAt: string | null;
  supplier: { id: string; name: string; code: string | null; status: string };
  purchaseOrder: { id: string; number: string; status: PurchaseOrderStatus } | null;
  createdBy: { id: string; displayName: string };
  approvedBy: { id: string; displayName: string } | null;
  items: PurchaseReturnItem[];
  physicalExecution: 'DEFERRED_TO_WAREHOUSE';
  financialResolution: 'DEFERRED_TO_FINANCE';
};
