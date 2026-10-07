export type SalesChannelType =
  | 'WEBSITE'
  | 'MARKETPLACE'
  | 'WHOLESALE'
  | 'MANUAL'
  | 'OTHER';

export type SalesChannelStatus = 'ACTIVE' | 'INACTIVE';

export type CustomerType = 'INDIVIDUAL' | 'BUSINESS';
export type CustomerStatus = 'ACTIVE' | 'INACTIVE';

export type SalesOrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'PARTIALLY_FULFILLED'
  | 'FULFILLED'
  | 'CANCELLED';

export type SalesOrderPaymentTermType = 'CASH' | 'CREDIT' | 'PARTIAL';
export type SalesCurrency = 'IRR' | 'USD';

export type SalesReturnStatus = 'DRAFT' | 'APPROVED' | 'RECEIVED' | 'CANCELLED';
export type SalesFulfillmentStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';

export type SalesChannel = {
  id: string;
  code: string;
  name: string;
  type: SalesChannelType;
  status: SalesChannelStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerListItem = {
  id: string;
  code: string | null;
  displayName: string;
  type: CustomerType;
  status: CustomerStatus;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerDetail = CustomerListItem & {
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  nationalId: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  notes: string | null;
  addresses: Array<{
    id: string;
    label: string | null;
    recipientName: string | null;
    mobile: string | null;
    province: string | null;
    city: string | null;
    addressLine: string | null;
    postalCode: string | null;
    isDefault: boolean;
    status: string;
  }>;
};

export type SalesOrderItemQuantities = {
  ordered: number;
  cancelled: number;
  reservedRemaining: number;
  fulfilled: number;
  returned: number;
  remainingToFulfill: number;
};

export type SalesOrderItem = {
  id: string;
  salesOrderId: string;
  skuId: string;
  quantity: number;
  unitPrice: string;
  discountAmount: string;
  lineSubtotal: string;
  lineNetTotal: string;
  cancelledQuantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  skuCodeSnapshot: string | null;
  productNameSnapshot: string | null;
  variantNameSnapshot: string | null;
  notes: string | null;
  sku: {
    id: string;
    code: string;
    name: string | null;
    product: { id: string; name: string; code: string | null };
  };
  quantities?: SalesOrderItemQuantities;
};

export type SalesOrder = {
  id: string;
  companyId: string;
  orderNumber: string;
  channelId: string;
  customerId: string | null;
  status: SalesOrderStatus;
  currency: SalesCurrency;
  paymentTermType: SalesOrderPaymentTermType;
  dueDate: string | null;
  expectedUpfrontAmount: string | null;
  source: string;
  externalOrderId: string | null;
  externalReference: string | null;
  customerNameSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  shippingAddressSnapshot: string | null;
  billingAddressSnapshot: string | null;
  subtotal: string;
  itemDiscountTotal: string;
  orderDiscountTotal: string;
  netItemsTotal: string;
  shippingAmount: string;
  otherCharges: string;
  grandTotal: string;
  notes: string | null;
  orderedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelNotes: string | null;
  createdAt: string;
  updatedAt: string;
  channel: {
    id: string;
    code: string;
    name: string;
    type: string;
    status: string;
  };
  customer: {
    id: string;
    code: string | null;
    displayName: string;
    status: string;
    mobile: string | null;
    phone: string | null;
  } | null;
  createdBy: { id: string; displayName: string };
  items: SalesOrderItem[];
  inventoryEffect: 'NONE' | 'RESERVED' | 'FULFILLED';
  financeEffect: 'NONE' | 'AR_RECOGNIZED';
  reservationSummary?: {
    activeCount: number;
    reservedRemainingTotal: number;
    lines: Array<{
      salesOrderItemId: string;
      reservationId: string;
      warehouseId: string;
      skuId: string;
      remainingQuantity: number;
      status: string;
    }>;
  };
  fulfillmentSummary?: {
    count: number;
    items: Array<{
      id: string;
      fulfillmentNumber: string;
      status: string;
      warehouseId: string;
      completedAt: string | null;
      createdAt: string;
    }>;
  };
  financeSummary?: {
    source: string;
    label: string;
    receivableCount: number;
    outstandingTotalByCurrency: Array<{ currency: string; amount: string }>;
    receivables: Array<{
      id: string;
      number: string;
      currency: string;
      amount: string;
      status: string;
      recognizedAt: string;
      dueDate: string | null;
      salesFulfillmentId: string | null;
      salesReturnId: string | null;
    }>;
  };
};

export type SalesReturn = {
  id: string;
  returnNumber: string;
  salesOrderId: string;
  status: SalesReturnStatus;
  reason: string | null;
  condition: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  salesOrder?: {
    id: string;
    orderNumber: string;
    channel?: { id: string; code: string; name: string };
  };
  items: Array<{
    id: string;
    salesOrderItemId: string;
    skuId: string;
    quantity: number;
    reason: string | null;
    condition: string | null;
    sku?: { id: string; code: string; name: string | null };
  }>;
};

export type SalesFulfillment = {
  id: string;
  fulfillmentNumber: string;
  salesOrderId: string;
  warehouseId: string;
  status: SalesFulfillmentStatus;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    salesOrderItemId: string;
    skuId: string;
    locationId: string;
    batchId: string;
    quantity: number;
    classification: string;
  }>;
};

export type SalesDashboard = {
  meta: {
    range: { preset: string; from: string; to: string; dayCount: number };
    channelId: string | null;
    labels: Record<string, string>;
  };
  snapshot: {
    openOrders: number;
    confirmedOrders: number;
    processingOrders: number;
    partiallyFulfilledOrders: number;
    pendingFulfillmentUnits: number;
    openReturns: number;
    pendingReturns: number;
  };
  period: {
    ordersCount: number;
    salesByCurrency: Array<{ currency: string; amount: string; orderCount: number }>;
  };
  salesByChannel: Array<{
    channelId: string;
    code: string;
    name: string;
    orderCount: number;
    salesValue: Array<{ currency: string; amount: string; orderCount: number }>;
    units: number;
  }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: SalesOrderStatus;
    currency: string;
    grandTotal: string;
    createdAt: string;
    orderedAt: string | null;
    channel: { id: string; code: string; name: string };
    customer: { id: string; displayName: string } | null;
  }>;
  outstandingReceivables: {
    source: string;
    label: string;
    items: Array<{
      id: string;
      number: string;
      currency: string;
      amount: string;
      status: string;
      recognizedAt: string;
      dueDate: string | null;
      salesOrderId: string;
      salesOrderNumber: string;
      channel: { id: string; code: string; name: string };
      customer: { id: string; displayName: string } | null;
    }>;
  };
};
