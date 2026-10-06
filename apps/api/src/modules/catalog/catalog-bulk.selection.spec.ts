import {
  assertBulkSelectionValid,
  dedupeIds,
  hasMeaningfulProductFilter,
  hasMeaningfulSkuFilter,
} from './catalog-bulk.selection';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';

describe('catalog-bulk.selection', () => {
  it('dedupes explicit ids', () => {
    expect(dedupeIds(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('rejects empty IDS selection', () => {
    try {
      assertBulkSelectionValid({ mode: 'IDS', ids: [] }, 'PRODUCT');
      fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ERROR_CODES.BULK_EMPTY_SELECTION);
    }
  });

  it('rejects empty QUERY without selectAll', () => {
    try {
      assertBulkSelectionValid({ mode: 'QUERY', query: {} }, 'PRODUCT');
      fail('expected throw');
    } catch (error) {
      expect((error as AppError).code).toBe(ERROR_CODES.BULK_QUERY_UNSAFE);
    }
  });

  it('allows empty QUERY with selectAll=true', () => {
    expect(() =>
      assertBulkSelectionValid({ mode: 'QUERY', query: {}, selectAll: true }, 'PRODUCT'),
    ).not.toThrow();
  });

  it('allows QUERY with brandId without selectAll', () => {
    expect(() =>
      assertBulkSelectionValid(
        { mode: 'QUERY', query: { brandId: '11111111-1111-4111-8111-111111111111' } },
        'PRODUCT',
      ),
    ).not.toThrow();
  });

  it('detects meaningful product/sku filters', () => {
    expect(hasMeaningfulProductFilter({ status: 'ACTIVE' as never })).toBe(true);
    expect(hasMeaningfulProductFilter({})).toBe(false);
    expect(hasMeaningfulSkuFilter({ productId: 'x' })).toBe(true);
    expect(hasMeaningfulSkuFilter({})).toBe(false);
  });
});
