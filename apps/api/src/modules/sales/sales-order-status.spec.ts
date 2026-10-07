import { SalesOrderStatus } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import {
  assertSalesOrderEditable,
  assertSalesOrderTransition,
  canTransitionSalesOrder,
  isSalesOrderCommerciallyEditable,
  SALES_ORDER_RETURNABLE_STATUSES,
} from './sales-order-status';

describe('sales-order-status', () => {
  it('allows DRAFT → CONFIRMED / CANCELLED', () => {
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.CONFIRMED)).toBe(
      true,
    );
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.CANCELLED)).toBe(
      true,
    );
    expect(canTransitionSalesOrder(SalesOrderStatus.DRAFT, SalesOrderStatus.PROCESSING)).toBe(
      false,
    );
  });

  it('allows CONFIRMED → PROCESSING / PARTIALLY_FULFILLED / FULFILLED / CANCELLED', () => {
    expect(
      canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.PROCESSING),
    ).toBe(true);
    expect(
      canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.PARTIALLY_FULFILLED),
    ).toBe(true);
    expect(
      canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.FULFILLED),
    ).toBe(true);
    expect(
      canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.CANCELLED),
    ).toBe(true);
    expect(canTransitionSalesOrder(SalesOrderStatus.CONFIRMED, SalesOrderStatus.DRAFT)).toBe(
      false,
    );
  });

  it('blocks reverse from FULFILLED / CANCELLED', () => {
    expect(canTransitionSalesOrder(SalesOrderStatus.FULFILLED, SalesOrderStatus.DRAFT)).toBe(
      false,
    );
    expect(canTransitionSalesOrder(SalesOrderStatus.CANCELLED, SalesOrderStatus.DRAFT)).toBe(
      false,
    );
    expect(() =>
      assertSalesOrderTransition(SalesOrderStatus.FULFILLED, SalesOrderStatus.CANCELLED),
    ).toThrow(AppError);
  });

  it('allows fulfillment transitions in the map for future 5.3', () => {
    expect(
      canTransitionSalesOrder(SalesOrderStatus.PROCESSING, SalesOrderStatus.PARTIALLY_FULFILLED),
    ).toBe(true);
    expect(
      canTransitionSalesOrder(SalesOrderStatus.PROCESSING, SalesOrderStatus.FULFILLED),
    ).toBe(true);
    expect(
      canTransitionSalesOrder(
        SalesOrderStatus.PARTIALLY_FULFILLED,
        SalesOrderStatus.FULFILLED,
      ),
    ).toBe(true);
  });

  it('treats only DRAFT as commercially editable', () => {
    expect(isSalesOrderCommerciallyEditable(SalesOrderStatus.DRAFT)).toBe(true);
    expect(isSalesOrderCommerciallyEditable(SalesOrderStatus.CONFIRMED)).toBe(false);
    expect(() => assertSalesOrderEditable(SalesOrderStatus.CONFIRMED)).toThrow(AppError);
  });

  it('defines returnable statuses excluding DRAFT/CANCELLED', () => {
    expect(SALES_ORDER_RETURNABLE_STATUSES.has(SalesOrderStatus.CONFIRMED)).toBe(true);
    expect(SALES_ORDER_RETURNABLE_STATUSES.has(SalesOrderStatus.DRAFT)).toBe(false);
    expect(SALES_ORDER_RETURNABLE_STATUSES.has(SalesOrderStatus.CANCELLED)).toBe(false);
  });
});
