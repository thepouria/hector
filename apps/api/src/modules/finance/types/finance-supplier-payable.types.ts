import {
  Prisma,
  SupplierLiabilityMovementDirection,
  SupplierLiabilityMovementType,
  SupplierPayableStatus,
} from '@hector/database';
import {
  deriveAgingBucket,
  derivePayableStatus,
  derivePayableTotalsFromMovements,
  isPayableOverdue,
  type PayableAgingBucket,
} from '../supplier-payable-outstanding';

export type SupplierPayableLineView = {
  id: string;
  goodsReceiptId: string;
  goodsReceiptItemId: string;
  purchaseOrderItemId: string;
  skuId: string | null;
  quantity: number;
  unitPrice: string;
  lineAmount: string;
  currency: string;
  recognizedAt: string;
};

export type SupplierLiabilityMovementView = {
  id: string;
  payableId: string | null;
  supplierId: string;
  direction: string;
  type: string;
  amount: string;
  currency: string;
  sourceType: string;
  sourceId: string;
  supplierCreditId: string | null;
  effectiveAt: string;
  notes: string | null;
  createdAt: string;
};

export type SupplierPayableView = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  purchaseType: string;
  currency: string;
  referenceFxRate: string | null;
  referenceFxBaseCurrency: string | null;
  referenceFxQuoteCurrency: string | null;
  dueDate: string | null;
  status: SupplierPayableStatus;
  recognizedAt: string;
  notes: string | null;
  reference: string | null;
  recognizedAmount: string;
  outstandingAmount: string;
  overdue: boolean;
  agingBucket: PayableAgingBucket;
  lines?: SupplierPayableLineView[];
  movements?: SupplierLiabilityMovementView[];
  createdAt: string;
  updatedAt: string;
};

export type SupplierPayableSummaryCurrencyRow = {
  currency: string;
  payableCount: number;
  outstandingTotal: string;
  overdueTotal: string;
  openCreditTotal: string;
};

export type SupplierPayableAgingRow = {
  currency: string;
  bucket: PayableAgingBucket;
  payableCount: number;
  outstandingTotal: string;
};

export type SupplierStatementEntryView = {
  effectiveAt: string;
  kind: 'PAYABLE_INCREASE' | 'PAYABLE_DECREASE' | 'CREDIT';
  payableId: string | null;
  payableNumber: string | null;
  creditId: string | null;
  creditNumber: string | null;
  type: string;
  direction: string | null;
  amount: string;
  currency: string;
  notes: string | null;
};

export function moneyString(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed();
}

export function buildPayableAmounts(movements: Array<{
  direction: 'INCREASE' | 'DECREASE';
  amount: Prisma.Decimal;
  type?: string;
}>): {
  recognized: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  status: SupplierPayableStatus;
} {
  const totals = derivePayableTotalsFromMovements(
    movements.map((m) => ({
      direction:
        m.direction === 'DECREASE'
          ? SupplierLiabilityMovementDirection.DECREASE
          : SupplierLiabilityMovementDirection.INCREASE,
      amount: m.amount,
      type:
        m.type === SupplierLiabilityMovementType.REVERSAL
          ? SupplierLiabilityMovementType.REVERSAL
          : SupplierLiabilityMovementType.PURCHASE_RECOGNITION,
    })),
  );
  return {
    recognized: totals.recognized,
    outstanding: totals.outstanding,
    status: derivePayableStatus({
      recognized: totals.recognized,
      outstanding: totals.outstanding,
      currentStatus: SupplierPayableStatus.OPEN,
    }),
  };
}

export function attachDerivedPayableFields(input: {
  dueDate: Date | null;
  status: SupplierPayableStatus;
  recognized: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  now?: Date;
}): {
  status: SupplierPayableStatus;
  overdue: boolean;
  agingBucket: PayableAgingBucket;
} {
  const status =
    input.status === SupplierPayableStatus.CANCELLED
      ? SupplierPayableStatus.CANCELLED
      : derivePayableStatus({
          recognized: input.recognized,
          outstanding: input.outstanding,
          currentStatus: input.status,
        });
  return {
    status,
    overdue: isPayableOverdue({
      dueDate: input.dueDate,
      outstanding: input.outstanding,
      now: input.now,
    }),
    agingBucket: deriveAgingBucket({
      dueDate: input.dueDate,
      outstanding: input.outstanding,
      now: input.now,
    }),
  };
}
