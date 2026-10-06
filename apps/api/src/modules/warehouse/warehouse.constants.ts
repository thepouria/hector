export const WAREHOUSE_ERROR_MESSAGES = {
  NOT_FOUND: 'Warehouse not found.',
  CODE_ALREADY_EXISTS: 'A warehouse with this code already exists in the company.',
  INVALID_STATUS_TRANSITION: 'This warehouse status transition is not allowed.',
  DEFAULT_CONFLICT: 'Another warehouse is already the company default.',
  DEFAULT_REQUIRES_ACTIVE: 'Only an ACTIVE warehouse can be the company default.',
  DEFAULT_REPLACEMENT_REQUIRED:
    'Deactivating the default warehouse requires selecting another ACTIVE warehouse as the new default.',
  DEFAULT_REPLACEMENT_INVALID:
    'Replacement default warehouse must be an ACTIVE warehouse in the same company.',
  INVALID_CODE:
    'Warehouse code must be 1–64 characters using A–Z, 0–9, underscore, or hyphen (e.g. MAIN, THR-01).',
  INVALID_NAME: 'Warehouse name is required and must be at most 200 characters.',
  INVALID_ADDRESS: 'Warehouse address must be at most 500 characters.',
  INVALID_NOTES: 'Warehouse notes must be at most 2000 characters.',
  HAS_ACTIVE_LOCATIONS:
    'Cannot deactivate a warehouse while it has active locations. Deactivate locations first.',
} as const;

export const WAREHOUSE_CODE_MAX_LENGTH = 64;
export const WAREHOUSE_NAME_MAX_LENGTH = 200;
export const WAREHOUSE_ADDRESS_MAX_LENGTH = 500;
export const WAREHOUSE_NOTES_MAX_LENGTH = 2000;
export const WAREHOUSE_SEARCH_MAX_LENGTH = 100;

/** Same operational code alphabet as Catalog internal codes. */
export const WAREHOUSE_CODE_PATTERN = /^[A-Z0-9_-]+$/;

export const WAREHOUSE_SORT_FIELDS = ['name', 'code', 'status', 'updatedAt', 'createdAt'] as const;
export type WarehouseSortField = (typeof WAREHOUSE_SORT_FIELDS)[number];
