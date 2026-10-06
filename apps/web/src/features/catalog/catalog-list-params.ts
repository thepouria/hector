/**
 * URL-backed list state for the Catalog workspace.
 *
 * Pure parsing/serialization only so the rules stay unit-testable; the React wrapper
 * lives in `use-catalog-list-params.ts`. Unknown or malformed values fall back to the
 * defaults instead of being forwarded to the API, so a hand-edited URL cannot turn into
 * a 400 loop.
 */

/** Minimal shape shared by `URLSearchParams` and Next's `ReadonlyURLSearchParams`. */
export type CatalogParamReader = { get(name: string): string | null };

/** Mirrors `CATALOG_SEARCH_MAX_LENGTH` on the API. */
export const CATALOG_SEARCH_MAX_LENGTH = 100;

export const CATALOG_PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_CATALOG_PAGE_SIZE = 20;

export const CATALOG_STATUS_VALUES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
/** Empty string means "no status filter". */
export type CatalogStatusFilter = '' | (typeof CATALOG_STATUS_VALUES)[number];

export type SortOrder = 'asc' | 'desc';

export const PRODUCT_SORT_FIELDS = ['name', 'code', 'status', 'createdAt', 'updatedAt'] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

export const SKU_SORT_FIELDS = ['code', 'name', 'status', 'createdAt', 'updatedAt'] as const;
export type SkuSortField = (typeof SKU_SORT_FIELDS)[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readSearch(reader: CatalogParamReader): string {
  const raw = reader.get('q');
  if (!raw) return '';
  return raw.trim().slice(0, CATALOG_SEARCH_MAX_LENGTH);
}

function readPage(reader: CatalogParamReader): number {
  const parsed = Number(reader.get('page'));
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

function readPageSize(reader: CatalogParamReader): number {
  const parsed = Number(reader.get('pageSize'));
  return (CATALOG_PAGE_SIZES as readonly number[]).includes(parsed)
    ? parsed
    : DEFAULT_CATALOG_PAGE_SIZE;
}

function readStatus(reader: CatalogParamReader): CatalogStatusFilter {
  const raw = reader.get('status')?.toUpperCase() ?? '';
  return (CATALOG_STATUS_VALUES as readonly string[]).includes(raw)
    ? (raw as CatalogStatusFilter)
    : '';
}

function readUuid(reader: CatalogParamReader, key: string): string {
  const raw = reader.get(key)?.trim() ?? '';
  return UUID_PATTERN.test(raw) ? raw : '';
}

function readSortField<T extends string>(
  reader: CatalogParamReader,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = reader.get('sort')?.trim() ?? '';
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function readSortOrder(reader: CatalogParamReader, fallback: SortOrder): SortOrder {
  const raw = reader.get('order')?.trim().toLowerCase() ?? '';
  return raw === 'asc' || raw === 'desc' ? raw : fallback;
}

function appendDefaulted(
  params: URLSearchParams,
  key: string,
  value: string | number,
  defaultValue: string | number,
): void {
  if (value === defaultValue || value === '') return;
  params.set(key, String(value));
}

// --- Products ---

export type ProductListParams = {
  q: string;
  page: number;
  pageSize: number;
  status: CatalogStatusFilter;
  brandId: string;
  categoryId: string;
  /** Tri-state: '' = unset, 'true'/'false' = filter. */
  hasSku: '' | 'true' | 'false';
  /** When category filter is set, include descendants (default true). */
  includeDescendants: boolean;
  /** Raw attrs query: code:op:value,... */
  attrs: string;
  sortBy: ProductSortField;
  sortOrder: SortOrder;
};

export const DEFAULT_PRODUCT_LIST_PARAMS: ProductListParams = {
  q: '',
  page: 1,
  pageSize: DEFAULT_CATALOG_PAGE_SIZE,
  status: '',
  brandId: '',
  categoryId: '',
  hasSku: '',
  includeDescendants: true,
  attrs: '',
  sortBy: 'name',
  sortOrder: 'asc',
};

export function parseProductListParams(reader: CatalogParamReader): ProductListParams {
  const rawHasSku = reader.get('hasSku')?.trim().toLowerCase() ?? '';
  const rawDesc = reader.get('descendants')?.trim().toLowerCase() ?? '';
  return {
    q: readSearch(reader),
    page: readPage(reader),
    pageSize: readPageSize(reader),
    status: readStatus(reader),
    brandId: readUuid(reader, 'brand'),
    categoryId: readUuid(reader, 'category'),
    hasSku: rawHasSku === 'true' || rawHasSku === 'false' ? rawHasSku : '',
    includeDescendants: rawDesc === 'false' || rawDesc === '0' ? false : true,
    attrs: (reader.get('attrs') ?? '').trim().slice(0, 2000),
    sortBy: readSortField(reader, PRODUCT_SORT_FIELDS, DEFAULT_PRODUCT_LIST_PARAMS.sortBy),
    sortOrder: readSortOrder(reader, DEFAULT_PRODUCT_LIST_PARAMS.sortOrder),
  };
}

export function serializeProductListParams(params: ProductListParams): URLSearchParams {
  const search = new URLSearchParams();
  appendDefaulted(search, 'q', params.q, '');
  appendDefaulted(search, 'status', params.status, '');
  appendDefaulted(search, 'brand', params.brandId, '');
  appendDefaulted(search, 'category', params.categoryId, '');
  appendDefaulted(search, 'hasSku', params.hasSku, '');
  if (params.categoryId && !params.includeDescendants) {
    search.set('descendants', 'false');
  }
  appendDefaulted(search, 'attrs', params.attrs, '');
  appendDefaulted(search, 'sort', params.sortBy, DEFAULT_PRODUCT_LIST_PARAMS.sortBy);
  appendDefaulted(search, 'order', params.sortOrder, DEFAULT_PRODUCT_LIST_PARAMS.sortOrder);
  appendDefaulted(search, 'pageSize', params.pageSize, DEFAULT_CATALOG_PAGE_SIZE);
  appendDefaulted(search, 'page', params.page, 1);
  return search;
}

/** Server-side list query. Pagination, search and filters are never applied client-side. */
export function buildProductListQuery(
  params: ProductListParams,
): Record<string, string | number | boolean | undefined> {
  return {
    page: params.page,
    pageSize: params.pageSize,
    search: params.q || undefined,
    status: params.status || undefined,
    brandId: params.brandId || undefined,
    categoryId: params.categoryId || undefined,
    includeDescendants: params.categoryId ? params.includeDescendants : undefined,
    hasSku: params.hasSku || undefined,
    attrs: params.attrs || undefined,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
}

// --- SKUs ---

/** Tri-state because `hasBarcode=false` is a meaningful filter. */
export type HasBarcodeFilter = '' | 'true' | 'false';

export type SkuListParams = {
  q: string;
  page: number;
  pageSize: number;
  status: CatalogStatusFilter;
  productId: string;
  hasBarcode: HasBarcodeFilter;
  sortBy: SkuSortField;
  sortOrder: SortOrder;
};

export const DEFAULT_SKU_LIST_PARAMS: SkuListParams = {
  q: '',
  page: 1,
  pageSize: DEFAULT_CATALOG_PAGE_SIZE,
  status: '',
  productId: '',
  hasBarcode: '',
  sortBy: 'code',
  sortOrder: 'asc',
};

export function parseSkuListParams(reader: CatalogParamReader): SkuListParams {
  const rawBarcode = reader.get('barcode')?.trim().toLowerCase() ?? '';
  return {
    q: readSearch(reader),
    page: readPage(reader),
    pageSize: readPageSize(reader),
    status: readStatus(reader),
    productId: readUuid(reader, 'product'),
    hasBarcode: rawBarcode === 'true' || rawBarcode === 'false' ? rawBarcode : '',
    sortBy: readSortField(reader, SKU_SORT_FIELDS, DEFAULT_SKU_LIST_PARAMS.sortBy),
    sortOrder: readSortOrder(reader, DEFAULT_SKU_LIST_PARAMS.sortOrder),
  };
}

export function serializeSkuListParams(params: SkuListParams): URLSearchParams {
  const search = new URLSearchParams();
  appendDefaulted(search, 'q', params.q, '');
  appendDefaulted(search, 'status', params.status, '');
  appendDefaulted(search, 'product', params.productId, '');
  appendDefaulted(search, 'barcode', params.hasBarcode, '');
  appendDefaulted(search, 'sort', params.sortBy, DEFAULT_SKU_LIST_PARAMS.sortBy);
  appendDefaulted(search, 'order', params.sortOrder, DEFAULT_SKU_LIST_PARAMS.sortOrder);
  appendDefaulted(search, 'pageSize', params.pageSize, DEFAULT_CATALOG_PAGE_SIZE);
  appendDefaulted(search, 'page', params.page, 1);
  return search;
}

export function buildSkuListQuery(
  params: SkuListParams,
): Record<string, string | number | undefined> {
  return {
    page: params.page,
    pageSize: params.pageSize,
    search: params.q || undefined,
    status: params.status || undefined,
    productId: params.productId || undefined,
    hasBarcode: params.hasBarcode || undefined,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  };
}

/** Filters a user can clear; sorting and pagination are excluded on purpose. */
export function countActiveFilters(
  params: ProductListParams | SkuListParams,
): number {
  const values = [
    params.q,
    params.status,
    'brandId' in params ? params.brandId : '',
    'categoryId' in params ? params.categoryId : '',
    'productId' in params ? params.productId : '',
    'hasBarcode' in params ? params.hasBarcode : '',
    'hasSku' in params ? params.hasSku : '',
    'attrs' in params ? params.attrs : '',
    'categoryId' in params && params.categoryId && !params.includeDescendants
      ? 'exact-category'
      : '',
  ];
  return values.filter((value) => value !== '').length;
}

export function totalPages(meta: { total: number; pageSize: number } | undefined): number {
  if (!meta || meta.pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(meta.total / meta.pageSize));
}
