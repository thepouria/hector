/**
 * Sales domain constants (Phase 5.1 Channel + Customer; Phase 5.2 Orders + Returns).
 * Permission keys are also registered in packages/database/src/permissions.ts.
 */

export const SALES_CHANNEL_CODE_MAX_LENGTH = 64;
export const SALES_CHANNEL_NAME_MAX_LENGTH = 200;
export const SALES_CHANNEL_NOTES_MAX_LENGTH = 2000;
export const SALES_CHANNEL_SEARCH_MAX_LENGTH = 200;
export const SALES_CHANNEL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
export const SALES_CHANNEL_SORT_FIELDS = ['name', 'code', 'createdAt', 'updatedAt'] as const;
export type SalesChannelSortField = (typeof SALES_CHANNEL_SORT_FIELDS)[number];

export const CUSTOMER_CODE_MAX_LENGTH = 64;
export const CUSTOMER_DISPLAY_NAME_MAX_LENGTH = 200;
export const CUSTOMER_PERSON_NAME_MAX_LENGTH = 120;
export const CUSTOMER_BUSINESS_NAME_MAX_LENGTH = 200;
export const CUSTOMER_PHONE_MAX_LENGTH = 64;
export const CUSTOMER_EMAIL_MAX_LENGTH = 254;
export const CUSTOMER_ID_FIELD_MAX_LENGTH = 64;
export const CUSTOMER_NOTES_MAX_LENGTH = 2000;
export const CUSTOMER_SEARCH_MAX_LENGTH = 200;
export const CUSTOMER_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
export const CUSTOMER_SORT_FIELDS = ['displayName', 'createdAt', 'updatedAt'] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export const CUSTOMER_ADDRESS_LABEL_MAX_LENGTH = 80;
export const CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH = 120;
export const CUSTOMER_ADDRESS_LINE_MAX_LENGTH = 500;
export const CUSTOMER_ADDRESS_CITY_MAX_LENGTH = 120;
export const CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH = 120;
export const CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH = 32;
export const CUSTOMER_ADDRESS_NOTES_MAX_LENGTH = 1000;

export const SALES_ORDER_MAX_ITEMS = 500;
export const SALES_ORDER_MAX_QUANTITY = 10_000_000;
export const SALES_ORDER_MAX_UNIT_PRICE = '1000000000000';
export const SALES_ORDER_MAX_GRAND_TOTAL = '1000000000000000';
export const SALES_ORDER_NOTES_MAX_LENGTH = 2000;
export const SALES_ORDER_SNAPSHOT_MAX_LENGTH = 2000;
export const SALES_ORDER_EXTERNAL_ID_MAX_LENGTH = 200;
export const SALES_ORDER_SEARCH_MAX_LENGTH = 200;
export const SALES_ORDER_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'orderedAt',
  'orderNumber',
  'grandTotal',
] as const;
export type SalesOrderSortField = (typeof SALES_ORDER_SORT_FIELDS)[number];

export const SALES_RETURN_NOTES_MAX_LENGTH = 2000;
export const SALES_RETURN_SEARCH_MAX_LENGTH = 200;
export const SALES_RETURN_SORT_FIELDS = ['createdAt', 'updatedAt', 'returnNumber'] as const;
export type SalesReturnSortField = (typeof SALES_RETURN_SORT_FIELDS)[number];

export const SALES_FULFILLMENT_NOTES_MAX_LENGTH = 2000;
export const SALES_FULFILLMENT_SEARCH_MAX_LENGTH = 200;
export const SALES_FULFILLMENT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'fulfillmentNumber',
] as const;
export type SalesFulfillmentSortField = (typeof SALES_FULFILLMENT_SORT_FIELDS)[number];

export const CUSTOMER_RECEIVABLE_SEARCH_MAX_LENGTH = 200;
export const CUSTOMER_RECEIVABLE_SORT_FIELDS = [
  'createdAt',
  'recognizedAt',
  'number',
  'amount',
] as const;
export type CustomerReceivableSortField = (typeof CUSTOMER_RECEIVABLE_SORT_FIELDS)[number];

export const SALES_ERROR_MESSAGES = {
  SALES_CHANNEL_NOT_FOUND: 'Sales channel was not found.',
  SALES_CHANNEL_CODE_ALREADY_EXISTS:
    'A sales channel with this code already exists in the company.',
  SALES_CHANNEL_INVALID_STATUS_TRANSITION:
    'This sales channel status transition is not allowed.',
  INVALID_SALES_CHANNEL_CODE: 'Sales channel code is invalid.',
  INVALID_SALES_CHANNEL_NAME: 'Sales channel name is invalid.',

  CUSTOMER_NOT_FOUND: 'Customer was not found.',
  CUSTOMER_CODE_ALREADY_EXISTS: 'A customer with this code already exists in the company.',
  CUSTOMER_INVALID_STATUS_TRANSITION: 'This customer status transition is not allowed.',
  INVALID_CUSTOMER_DISPLAY_NAME: 'Customer display name is invalid.',
  INVALID_CUSTOMER_CODE: 'Customer code is invalid.',
  INVALID_CUSTOMER_EMAIL: 'Customer email is invalid.',

  CUSTOMER_ADDRESS_NOT_FOUND: 'Customer address was not found.',
  CUSTOMER_ADDRESS_ALREADY_ARCHIVED: 'Customer address is already archived.',
  CUSTOMER_DEFAULT_ADDRESS_CONFLICT: 'Another address is already marked as default.',

  SALES_ORDER_NOT_FOUND: 'Sales order was not found.',
  SALES_ORDER_ITEM_NOT_FOUND: 'Sales order item was not found.',
  SALES_ORDER_INVALID_STATUS_TRANSITION: 'This sales order status transition is not allowed.',
  SALES_ORDER_NOT_EDITABLE: 'Only DRAFT sales orders can be edited.',
  SALES_ORDER_EMPTY: 'Sales order must have at least one item.',
  SALES_ORDER_INVALID_PRICE: 'Sales order unit price is invalid.',
  SALES_ORDER_INVALID_MONEY: 'Sales order money amount is invalid.',
  SALES_ORDER_INVALID_QUANTITY: 'Sales order quantity is invalid.',
  SALES_ORDER_DISCOUNT_EXCEEDS_SUBTOTAL: 'Discount cannot exceed the applicable subtotal.',
  SALES_ORDER_TOTAL_OUT_OF_RANGE: 'Sales order total exceeds the supported range.',
  SALES_ORDER_CHANNEL_NOT_ACTIVE: 'Sales channel must be ACTIVE to create or confirm orders.',
  SALES_ORDER_CUSTOMER_NOT_ASSIGNABLE: 'Customer is not assignable to this sales order.',
  SALES_ORDER_SKU_NOT_ASSIGNABLE: 'SKU is not assignable to this sales order.',
  SALES_ORDER_CANCEL_QUANTITY_INVALID: 'Cancel quantity is invalid for this sales order item.',
  SALES_ORDER_EXTERNAL_ORDER_CONFLICT:
    'An order with this external order id already exists for the channel.',
  SALES_ORDER_PARTIAL_REQUIRES_UPFRONT:
    'PARTIAL payment terms require an expected upfront amount.',

  SALES_RETURN_NOT_FOUND: 'Sales return was not found.',
  SALES_RETURN_INVALID_STATUS: 'Sales return status does not allow this action.',
  SALES_RETURN_INVALID_ORDER_STATUS:
    'Sales returns cannot be created against this sales order status.',
  SALES_RETURN_ITEM_INVALID: 'Sales return item is invalid for the sales order.',
  SALES_RETURN_SKU_MISMATCH: 'Sales return SKU does not match the sales order item.',
  SALES_RETURN_QUANTITY_EXCEEDS_RETURNABLE:
    'Return quantity exceeds fulfilled returnable quantity.',
  SALES_RETURN_EMPTY: 'Sales return must have at least one item.',
  SALES_RETURN_RECEIVE_INVALID: 'Sales return physical receive input is invalid.',

  SALES_FULFILLMENT_NOT_FOUND: 'Sales fulfillment was not found.',
  SALES_FULFILLMENT_NOT_EDITABLE: 'Only DRAFT sales fulfillments can be edited or cancelled.',
  SALES_FULFILLMENT_INVALID_STATUS: 'Sales fulfillment status does not allow this action.',
  SALES_FULFILLMENT_EMPTY: 'Sales fulfillment must have at least one item.',
  SALES_FULFILLMENT_QUANTITY_EXCEEDS_FULFILLABLE:
    'Fulfillment quantity exceeds fulfillable quantity on the sales order item.',
  SALES_FULFILLMENT_ORDER_NOT_EXECUTABLE:
    'Sales order status does not allow fulfillment.',
  SALES_FULFILLMENT_WAREHOUSE_INVALID: 'Warehouse is invalid for sales fulfillment.',
  SALES_FULFILLMENT_ITEM_INVALID: 'Sales fulfillment item is invalid.',
  SALES_RESERVATION_ORDER_NOT_RESERVABLE:
    'Sales order status does not allow reservation.',
  SALES_RESERVATION_WAREHOUSE_REQUIRED:
    'A warehouse is required to reserve a sales order.',
  CUSTOMER_RECEIVABLE_NOT_FOUND: 'Customer receivable was not found.',
  CUSTOMER_RECEIVABLE_ALREADY_RECOGNIZED:
    'Receivable has already been recognized for this source.',
} as const;
