import { WarehouseLocationType } from '@hector/database';

export const LOCATION_ERROR_MESSAGES = {
  NOT_FOUND: 'Warehouse location not found.',
  WAREHOUSE_INACTIVE: 'Cannot create locations under an inactive warehouse.',
  CODE_ALREADY_EXISTS: 'A location with this code already exists in the warehouse.',
  BARCODE_CONFLICT: 'Location barcode conflict. Retry the operation.',
  BARCODE_NOT_FOUND: 'Location barcode was not found.',
  INVALID_PARENT: 'Parent location must belong to the same warehouse.',
  SELF_PARENT: 'A location cannot be its own parent.',
  CYCLE: 'This parent change would create a cycle in the location hierarchy.',
  TYPE_INVERSION:
    'Location type cannot be higher in the physical hierarchy than its parent (e.g. BIN under ZONE is OK; ZONE under BIN is not).',
  ACTIVE_DESCENDANTS:
    'Cannot deactivate a location while it has active child locations. Deactivate descendants first.',
  WAREHOUSE_HAS_ACTIVE_LOCATIONS:
    'Cannot deactivate a warehouse while it has active locations. Deactivate locations first.',
  INVALID_CODE:
    'Location code must be 1–64 characters using A–Z, 0–9, underscore, or hyphen (e.g. S01, A-01-R02).',
  INVALID_NAME: 'Location name must be at most 200 characters when provided.',
  INVALID_NOTES: 'Location notes must be at most 2000 characters.',
  INVALID_TYPE: 'Location type is invalid.',
} as const;

export const LOCATION_CODE_MAX_LENGTH = 64;
export const LOCATION_NAME_MAX_LENGTH = 200;
export const LOCATION_NOTES_MAX_LENGTH = 2000;
export const LOCATION_SEARCH_MAX_LENGTH = 100;
export const LOCATION_BARCODE_MAX_LENGTH = 64;

/** Same operational code alphabet as Warehouse Master. */
export const LOCATION_CODE_PATTERN = /^[A-Z0-9_-]+$/;

/** Conceptual rank — rejects inverted hierarchy; skipped levels are allowed. */
export const LOCATION_TYPE_RANK: Record<WarehouseLocationType, number> = {
  [WarehouseLocationType.ZONE]: 10,
  [WarehouseLocationType.AISLE]: 20,
  [WarehouseLocationType.RACK]: 30,
  [WarehouseLocationType.SHELF]: 40,
  [WarehouseLocationType.BIN]: 50,
  /// System transit is not part of the physical hierarchy.
  [WarehouseLocationType.TRANSIT]: 1000,
};

/** Bound ancestor/descendant walks against pathological graphs. */
export const LOCATION_TRAVERSAL_MAX_DEPTH = 64;

export const LOCATION_SORT_FIELDS = [
  'code',
  'name',
  'type',
  'status',
  'sortOrder',
  'updatedAt',
  'createdAt',
] as const;
export type LocationSortField = (typeof LOCATION_SORT_FIELDS)[number];
