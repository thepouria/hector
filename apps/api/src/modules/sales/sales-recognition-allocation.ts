import { CurrencyCode, Prisma } from '@hector/database';
import {
  allocateByWeights,
  assertAllocationSumExact,
} from '../finance/purchase-cost-allocation-math';
import { roundMoneyAmount } from '../finance/money/money';

/**
 * Phase 5.3 revenue recognition allocation (fulfillment-scoped).
 *
 * Policy (documented in docs/sales-recognition.md):
 * - Line slice = (fulfilledQty / orderedQty) × lineNetTotal
 * - Order discount for this slice = orderDiscount × (sum(lineSlices) / netItemsTotal),
 *   distributed across lines by largest-remainder using line-slice weights
 * - shippingAmount + otherCharges recognized on the first COMPLETED fulfillment only
 * - Amounts are Prisma.Decimal; never JS floating point
 */

export type RecognitionOrderItem = {
  salesOrderItemId: string;
  skuId: string;
  orderedQuantity: number;
  lineNetTotal: Prisma.Decimal;
  /** Quantity fulfilled in this fulfillment document (sum of item lines for this order item). */
  fulfilledQuantity: number;
};

export type RecognitionFulfillmentItemLink = {
  salesFulfillmentItemId: string;
  salesOrderItemId: string;
  skuId: string;
  quantity: number;
};

export type RecognitionAllocationLine = {
  salesOrderItemId: string;
  salesFulfillmentItemId: string | null;
  skuId: string;
  quantity: number;
  /** Net recognized commercial amount for this line (after order-discount share). */
  amount: Prisma.Decimal;
};

export type RecognitionAllocationResult = {
  lines: RecognitionAllocationLine[];
  lineNetRecognized: Prisma.Decimal;
  orderDiscountShare: Prisma.Decimal;
  shippingAmount: Prisma.Decimal;
  otherCharges: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
};

export function allocateSalesRecognition(input: {
  currency: CurrencyCode;
  orderItems: RecognitionOrderItem[];
  fulfillmentItemLinks: RecognitionFulfillmentItemLink[];
  netItemsTotal: Prisma.Decimal;
  orderDiscountTotal: Prisma.Decimal;
  shippingAmount: Prisma.Decimal;
  otherCharges: Prisma.Decimal;
  /** True when this is the first COMPLETED fulfillment for the sales order. */
  isFirstFulfillment: boolean;
}): RecognitionAllocationResult {
  const zero = new Prisma.Decimal(0);
  const byOrderItem = new Map<string, RecognitionOrderItem>();
  for (const item of input.orderItems) {
    if (item.fulfilledQuantity <= 0) continue;
    if (item.orderedQuantity <= 0) {
      throw new Error('orderedQuantity must be positive for recognition.');
    }
    byOrderItem.set(item.salesOrderItemId, item);
  }

  // Gross line slices (before order discount).
  const grossByOrderItem = new Map<string, Prisma.Decimal>();
  let lineNetRecognized = zero;
  for (const item of byOrderItem.values()) {
    const slice = item.lineNetTotal
      .mul(item.fulfilledQuantity)
      .div(item.orderedQuantity);
    const rounded = roundMoneyAmount(slice, input.currency);
    grossByOrderItem.set(item.salesOrderItemId, rounded);
    lineNetRecognized = lineNetRecognized.add(rounded);
  }

  let orderDiscountShare = zero;
  const discountByOrderItem = new Map<string, Prisma.Decimal>();

  if (input.orderDiscountTotal.gt(0) && lineNetRecognized.gt(0) && input.netItemsTotal.gt(0)) {
    const rawShare = input.orderDiscountTotal
      .mul(lineNetRecognized)
      .div(input.netItemsTotal);
    orderDiscountShare = roundMoneyAmount(rawShare, input.currency);
    if (orderDiscountShare.gt(0)) {
      const allocated = allocateByWeights(
        orderDiscountShare,
        input.currency,
        [...grossByOrderItem.entries()].map(([salesOrderItemId, amount]) => ({
          targetId: salesOrderItemId,
          weight: amount,
        })),
      );
      assertAllocationSumExact(orderDiscountShare, allocated);
      for (const row of allocated) {
        discountByOrderItem.set(row.targetId, row.allocatedAmount);
      }
    }
  }

  const netByOrderItem = new Map<string, Prisma.Decimal>();
  for (const [id, gross] of grossByOrderItem) {
    const discount = discountByOrderItem.get(id) ?? zero;
    netByOrderItem.set(id, gross.sub(discount));
  }

  // Split order-item nets across fulfillment item links (same order item may have multiple pick lines).
  const lines: RecognitionAllocationLine[] = [];
  const linksByOrderItem = new Map<string, RecognitionFulfillmentItemLink[]>();
  for (const link of input.fulfillmentItemLinks) {
    const list = linksByOrderItem.get(link.salesOrderItemId) ?? [];
    list.push(link);
    linksByOrderItem.set(link.salesOrderItemId, list);
  }

  for (const [orderItemId, netAmount] of netByOrderItem) {
    const links = linksByOrderItem.get(orderItemId) ?? [];
    const orderItem = byOrderItem.get(orderItemId)!;
    if (links.length === 0) {
      lines.push({
        salesOrderItemId: orderItemId,
        salesFulfillmentItemId: null,
        skuId: orderItem.skuId,
        quantity: orderItem.fulfilledQuantity,
        amount: netAmount,
      });
      continue;
    }
    if (links.length === 1) {
      const link = links[0]!;
      lines.push({
        salesOrderItemId: orderItemId,
        salesFulfillmentItemId: link.salesFulfillmentItemId,
        skuId: link.skuId,
        quantity: link.quantity,
        amount: netAmount,
      });
      continue;
    }
    const split = allocateByWeights(
      netAmount.gt(0) ? netAmount : new Prisma.Decimal('0.000001'),
      input.currency,
      links.map((l) => ({
        targetId: l.salesFulfillmentItemId,
        weight: new Prisma.Decimal(l.quantity),
      })),
    );
    // If net was zero, force zero amounts.
    if (netAmount.lte(0)) {
      for (const link of links) {
        lines.push({
          salesOrderItemId: orderItemId,
          salesFulfillmentItemId: link.salesFulfillmentItemId,
          skuId: link.skuId,
          quantity: link.quantity,
          amount: zero,
        });
      }
      continue;
    }
    assertAllocationSumExact(netAmount, split);
    const byId = new Map(split.map((s) => [s.targetId, s.allocatedAmount]));
    for (const link of links) {
      lines.push({
        salesOrderItemId: orderItemId,
        salesFulfillmentItemId: link.salesFulfillmentItemId,
        skuId: link.skuId,
        quantity: link.quantity,
        amount: byId.get(link.salesFulfillmentItemId) ?? zero,
      });
    }
  }

  const shippingAmount = input.isFirstFulfillment ? input.shippingAmount : zero;
  const otherCharges = input.isFirstFulfillment ? input.otherCharges : zero;
  const itemsNetAfterDiscount = lineNetRecognized.sub(orderDiscountShare);
  const totalAmount = itemsNetAfterDiscount.add(shippingAmount).add(otherCharges);

  // Optional header lines for shipping / other charges (no order-item link).
  if (shippingAmount.gt(0)) {
    lines.push({
      salesOrderItemId: '',
      salesFulfillmentItemId: null,
      skuId: '',
      quantity: 0,
      amount: shippingAmount,
    });
  }
  if (otherCharges.gt(0)) {
    lines.push({
      salesOrderItemId: '',
      salesFulfillmentItemId: null,
      skuId: '',
      quantity: 0,
      amount: otherCharges,
    });
  }

  return {
    lines: lines.filter((l) => l.salesOrderItemId !== '' || l.amount.gt(0)),
    lineNetRecognized,
    orderDiscountShare,
    shippingAmount,
    otherCharges,
    totalAmount,
  };
}
