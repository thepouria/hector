export const RESERVATION_ERROR_MESSAGES = {
  NOT_FOUND: 'Reservation not found',
  INVALID_QUANTITY: 'Reservation quantity must be a positive integer',
  INSUFFICIENT_AVAILABLE: 'Insufficient SELLABLE available quantity to reserve',
  NOT_ACTIVE: 'Reservation is not ACTIVE',
  WAREHOUSE_INACTIVE: 'Warehouse is not operational',
  SYSTEM_WAREHOUSE: 'System warehouses cannot hold commercial reservations',
  SKU_NOT_FOUND: 'SKU not found',
  OVER_DECREASE: 'Cannot decrease reservation below zero remaining',
  EXPIRED_ALREADY: 'Reservation is already expired',
} as const;

export const AVAILABILITY_BULK_MAX = 200;
