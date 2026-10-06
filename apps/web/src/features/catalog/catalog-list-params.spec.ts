import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG_PAGE_SIZE,
  DEFAULT_PRODUCT_LIST_PARAMS,
  DEFAULT_SKU_LIST_PARAMS,
  buildProductListQuery,
  buildSkuListQuery,
  countActiveFilters,
  parseProductListParams,
  parseSkuListParams,
  serializeProductListParams,
  serializeSkuListParams,
  totalPages,
} from '@/features/catalog/catalog-list-params';

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const CATEGORY_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PRODUCT_ID = '99999999-8888-4777-8666-555555555555';

function reader(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('product list URL params', () => {
  it('falls back to defaults for an empty query string', () => {
    expect(parseProductListParams(reader(''))).toEqual(DEFAULT_PRODUCT_LIST_PARAMS);
  });

  it('reads search, filters, sorting and pagination', () => {
    const params = parseProductListParams(
      reader(
        `q=%20fan%20&page=3&pageSize=50&status=inactive&brand=${BRAND_ID}&category=${CATEGORY_ID}&sort=updatedAt&order=DESC`,
      ),
    );
    expect(params).toEqual({
      q: 'fan',
      page: 3,
      pageSize: 50,
      status: 'INACTIVE',
      brandId: BRAND_ID,
      categoryId: CATEGORY_ID,
      hasSku: '',
      includeDescendants: true,
      attrs: '',
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
  });

  it('reads hasSku, attrs and exact-category descendants=false', () => {
    const params = parseProductListParams(
      reader(`hasSku=false&attrs=spf:gte:30&category=${CATEGORY_ID}&descendants=false`),
    );
    expect(params.hasSku).toBe('false');
    expect(params.attrs).toBe('spf:gte:30');
    expect(params.includeDescendants).toBe(false);
  });

  it('ignores unsupported sort fields, page sizes and statuses', () => {
    const params = parseProductListParams(
      reader('status=DELETED&sort=price&order=sideways&pageSize=7&page=0'),
    );
    expect(params.status).toBe('');
    expect(params.sortBy).toBe('name');
    expect(params.sortOrder).toBe('asc');
    expect(params.pageSize).toBe(DEFAULT_CATALOG_PAGE_SIZE);
    expect(params.page).toBe(1);
  });

  it('drops non-uuid filter ids instead of forwarding them to the API', () => {
    const params = parseProductListParams(reader('brand=not-a-uuid&category='));
    expect(params.brandId).toBe('');
    expect(params.categoryId).toBe('');
  });

  it('caps the search term at the API maximum length', () => {
    const params = parseProductListParams(reader(`q=${'x'.repeat(250)}`));
    expect(params.q).toHaveLength(100);
  });

  it('omits default values when serializing', () => {
    expect(serializeProductListParams(DEFAULT_PRODUCT_LIST_PARAMS).toString()).toBe('');
  });

  it('round-trips a non-default state through the URL', () => {
    const params = {
      ...DEFAULT_PRODUCT_LIST_PARAMS,
      q: 'fan',
      page: 2,
      pageSize: 100,
      status: 'ARCHIVED' as const,
      brandId: BRAND_ID,
      sortBy: 'code' as const,
      sortOrder: 'desc' as const,
    };
    expect(parseProductListParams(reader(serializeProductListParams(params).toString()))).toEqual(
      params,
    );
  });

  it('maps URL params onto API query fields', () => {
    expect(
      buildProductListQuery({
        ...DEFAULT_PRODUCT_LIST_PARAMS,
        q: 'fan',
        brandId: BRAND_ID,
      }),
    ).toEqual({
      page: 1,
      pageSize: DEFAULT_CATALOG_PAGE_SIZE,
      search: 'fan',
      status: undefined,
      brandId: BRAND_ID,
      categoryId: undefined,
      includeDescendants: undefined,
      hasSku: undefined,
      attrs: undefined,
      sortBy: 'name',
      sortOrder: 'asc',
    });
  });
});

describe('sku list URL params', () => {
  it('falls back to defaults for an empty query string', () => {
    expect(parseSkuListParams(reader(''))).toEqual(DEFAULT_SKU_LIST_PARAMS);
  });

  it('reads the product scope and the tri-state barcode filter', () => {
    expect(parseSkuListParams(reader(`product=${PRODUCT_ID}&barcode=false`))).toMatchObject({
      productId: PRODUCT_ID,
      hasBarcode: 'false',
    });
    expect(parseSkuListParams(reader('barcode=TRUE')).hasBarcode).toBe('true');
    expect(parseSkuListParams(reader('barcode=maybe')).hasBarcode).toBe('');
  });

  it('round-trips a non-default state through the URL', () => {
    const params = {
      ...DEFAULT_SKU_LIST_PARAMS,
      q: 'FAN-01',
      page: 4,
      status: 'ACTIVE' as const,
      productId: PRODUCT_ID,
      hasBarcode: 'false' as const,
      sortBy: 'updatedAt' as const,
      sortOrder: 'desc' as const,
    };
    expect(parseSkuListParams(reader(serializeSkuListParams(params).toString()))).toEqual(params);
  });

  it('sends hasBarcode only when the filter is set', () => {
    expect(buildSkuListQuery(DEFAULT_SKU_LIST_PARAMS).hasBarcode).toBeUndefined();
    expect(
      buildSkuListQuery({ ...DEFAULT_SKU_LIST_PARAMS, hasBarcode: 'false' }).hasBarcode,
    ).toBe('false');
  });
});

describe('list helpers', () => {
  it('counts clearable filters without counting sorting or pagination', () => {
    expect(countActiveFilters(DEFAULT_PRODUCT_LIST_PARAMS)).toBe(0);
    expect(
      countActiveFilters({
        ...DEFAULT_PRODUCT_LIST_PARAMS,
        page: 5,
        sortOrder: 'desc',
        q: 'fan',
        status: 'ACTIVE',
      }),
    ).toBe(2);
    expect(
      countActiveFilters({ ...DEFAULT_SKU_LIST_PARAMS, productId: PRODUCT_ID, hasBarcode: 'true' }),
    ).toBe(2);
  });

  it('derives at least one page from pagination meta', () => {
    expect(totalPages(undefined)).toBe(1);
    expect(totalPages({ total: 0, pageSize: 20 })).toBe(1);
    expect(totalPages({ total: 41, pageSize: 20 })).toBe(3);
  });
});
