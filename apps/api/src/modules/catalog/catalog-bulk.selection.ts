import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';
import {
  BULK_IDS_MAX,
  BULK_OPERATIONS,
  CATALOG_ERROR_MESSAGES,
  type BulkOperationType,
} from './catalog.constants';
import type { CatalogLifecycleStatus } from '@hector/database';

export type BulkSelectionMode = 'IDS' | 'QUERY';

export type BulkProductQueryFilters = {
  search?: string;
  status?: CatalogLifecycleStatus;
  brandId?: string;
  categoryId?: string;
  includeDescendants?: boolean;
  hasSku?: boolean;
  attrs?: string;
};

export type BulkSkuQueryFilters = {
  search?: string;
  status?: CatalogLifecycleStatus;
  productId?: string;
  hasBarcode?: boolean;
  variantValueId?: string;
};

export type BulkSelectionInput = {
  mode: BulkSelectionMode;
  ids?: string[];
  query?: BulkProductQueryFilters | BulkSkuQueryFilters;
  excludedIds?: string[];
  /** Explicit intention to target the entire company catalog for this entity type. */
  selectAll?: boolean;
};

export const PRODUCT_BULK_OPERATIONS = new Set<BulkOperationType>([
  BULK_OPERATIONS.PRODUCT_CHANGE_BRAND,
  BULK_OPERATIONS.PRODUCT_CHANGE_CATEGORY,
  BULK_OPERATIONS.PRODUCT_ACTIVATE,
  BULK_OPERATIONS.PRODUCT_DEACTIVATE,
  BULK_OPERATIONS.PRODUCT_ARCHIVE,
  BULK_OPERATIONS.PRODUCT_ATTRIBUTE_SET,
  BULK_OPERATIONS.PRODUCT_ATTRIBUTE_REMOVE,
]);

export const SKU_BULK_OPERATIONS = new Set<BulkOperationType>([
  BULK_OPERATIONS.SKU_ACTIVATE,
  BULK_OPERATIONS.SKU_DEACTIVATE,
  BULK_OPERATIONS.SKU_ARCHIVE,
  BULK_OPERATIONS.SKU_ATTRIBUTE_SET,
  BULK_OPERATIONS.SKU_ATTRIBUTE_REMOVE,
]);

export function isProductBulkOperation(operation: string): boolean {
  return PRODUCT_BULK_OPERATIONS.has(operation as BulkOperationType);
}

export function isSkuBulkOperation(operation: string): boolean {
  return SKU_BULK_OPERATIONS.has(operation as BulkOperationType);
}

export function dedupeIds(ids: string[] | undefined): string[] {
  if (!ids?.length) return [];
  return [...new Set(ids)];
}

export function hasMeaningfulProductFilter(query: BulkProductQueryFilters | undefined): boolean {
  if (!query) return false;
  return Boolean(
    (query.search && query.search.trim()) ||
      query.status ||
      query.brandId ||
      query.categoryId ||
      query.hasSku !== undefined ||
      (query.attrs && query.attrs.trim()),
  );
}

export function hasMeaningfulSkuFilter(query: BulkSkuQueryFilters | undefined): boolean {
  if (!query) return false;
  return Boolean(
    (query.search && query.search.trim()) ||
      query.status ||
      query.productId ||
      query.hasBarcode !== undefined ||
      query.variantValueId,
  );
}

/**
 * Validates selection contract before DB resolution.
 * Empty QUERY without selectAll must never mean "entire catalog".
 */
export function assertBulkSelectionValid(
  selection: BulkSelectionInput,
  entity: 'PRODUCT' | 'SKU',
): { ids: string[]; excludedIds: string[] } {
  const excludedIds = dedupeIds(selection.excludedIds);
  if (excludedIds.length > BULK_IDS_MAX) {
    throw new AppError({
      code: ERROR_CODES.BULK_IDS_LIMIT_EXCEEDED,
      message: CATALOG_ERROR_MESSAGES.BULK_IDS_LIMIT_EXCEEDED,
      statusCode: 400,
      details: { max: BULK_IDS_MAX, received: excludedIds.length },
    });
  }

  if (selection.mode === 'IDS') {
    const ids = dedupeIds(selection.ids);
    if (ids.length === 0) {
      throw new AppError({
        code: ERROR_CODES.BULK_EMPTY_SELECTION,
        message: CATALOG_ERROR_MESSAGES.BULK_EMPTY_SELECTION,
        statusCode: 400,
      });
    }
    if (ids.length > BULK_IDS_MAX) {
      throw new AppError({
        code: ERROR_CODES.BULK_IDS_LIMIT_EXCEEDED,
        message: CATALOG_ERROR_MESSAGES.BULK_IDS_LIMIT_EXCEEDED,
        statusCode: 400,
        details: { max: BULK_IDS_MAX, received: ids.length },
      });
    }
    return { ids, excludedIds };
  }

  if (selection.mode !== 'QUERY') {
    throw new AppError({
      code: ERROR_CODES.BULK_INVALID_OPERATION,
      message: CATALOG_ERROR_MESSAGES.BULK_INVALID_OPERATION,
      statusCode: 400,
    });
  }

  const meaningful =
    entity === 'PRODUCT'
      ? hasMeaningfulProductFilter(selection.query as BulkProductQueryFilters | undefined)
      : hasMeaningfulSkuFilter(selection.query as BulkSkuQueryFilters | undefined);

  if (!meaningful && selection.selectAll !== true) {
    throw new AppError({
      code: ERROR_CODES.BULK_QUERY_UNSAFE,
      message: CATALOG_ERROR_MESSAGES.BULK_QUERY_UNSAFE,
      statusCode: 400,
    });
  }

  return { ids: [], excludedIds };
}
