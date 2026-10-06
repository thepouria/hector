import {
  assertBarcodeValue,
  assertBrandName,
  assertCategoryName,
  assertInternalCode,
  assertProductCode,
  assertProductName,
  assertSkuCode,
  assertSkuName,
  assertVariantOptionName,
  assertVariantOptionValue,
  normalizeBarcodeValue,
  normalizeCatalogNameKey,
  normalizeDisplayName,
  normalizeInternalCode,
  normalizeSearchNameKey,
  normalizeSearchQuery,
} from './catalog.normalization';
import { AppError } from '../../common/exceptions/app.error';
import {
  buildCategoryPath,
  buildCategoryTree,
  collectDescendantIds,
  isAncestorOrSelf,
  isCategoryAssignable,
} from './category-tree.util';

describe('catalog.normalization', () => {
  it('normalizes SKU codes with trim + uppercase', () => {
    expect(normalizeInternalCode('  fan-sl-01  ')).toBe('FAN-SL-01');
    expect(assertInternalCode('fan-sl-01', 'sku')).toBe('FAN-SL-01');
  });

  it('allows period in SKU codes but not in product codes', () => {
    expect(assertSkuCode(' fan.sl.01 ')).toEqual({ code: 'FAN.SL.01', normalizedCode: 'FAN.SL.01' });
    expect(() => assertInternalCode('FAN.SL', 'product')).toThrow(AppError);
  });

  it('normalizes SKU names', () => {
    expect(assertSkuName('  رنگ   01 ')).toBe('رنگ 01');
    expect(assertSkuName('   ')).toBeNull();
    expect(assertSkuName(undefined)).toBeNull();
    expect(() => assertSkuName('x'.repeat(201))).toThrow(AppError);
  });

  it('normalizes variant option names for uniqueness', () => {
    const a = assertVariantOptionName('  Color ');
    const b = assertVariantOptionName('color');
    expect(a.normalizedName).toBe(b.normalizedName);
    expect(a.name).toBe('Color');
    expect(assertVariantOptionName('رنگ').normalizedName).toBe('رنگ');
    expect(() => assertVariantOptionName('   ')).toThrow(AppError);
  });

  it('normalizes variant values (Arabic yeh/kaf, whitespace, case)', () => {
    expect(assertVariantOptionValue('  ي  ك ').normalizedValue).toBe('ی ک');
    expect(assertVariantOptionValue('Black').normalizedValue).toBe(
      assertVariantOptionValue(' black ').normalizedValue,
    );
    expect(assertVariantOptionValue('01').value).toBe('01');
    expect(() => assertVariantOptionValue('')).toThrow(AppError);
    expect(() => assertVariantOptionValue('x'.repeat(81))).toThrow(AppError);
  });

  it('rejects invalid SKU code characters', () => {
    expect(() => assertInternalCode('FAN SL 01', 'sku')).toThrow(AppError);
    expect(() => assertInternalCode('FAN@01', 'sku')).toThrow(AppError);
  });

  it('trims barcodes without uppercasing', () => {
    expect(normalizeBarcodeValue('  001234  ')).toBe('001234');
    expect(assertBarcodeValue('  DEV-bc-01  ')).toBe('DEV-bc-01');
  });

  it('rejects empty barcodes', () => {
    expect(() => assertBarcodeValue('   ')).toThrow(AppError);
  });

  it('preserves Persian display names while collapsing whitespace', () => {
    expect(normalizeDisplayName('  رژ  لب   جامد  ')).toBe('رژ لب جامد');
  });

  it('builds uniqueness keys with NFKC, Persian Yeh/Kaf, and case-fold', () => {
    expect(normalizeCatalogNameKey(' Essence ')).toBe('essence');
    expect(normalizeCatalogNameKey('ESSENCE')).toBe('essence');
    expect(normalizeCatalogNameKey('يك')).toBe(normalizeCatalogNameKey('یک'));
  });

  it('assertBrandName returns display + key', () => {
    const brand = assertBrandName('  Fanoma  ');
    expect(brand.name).toBe('Fanoma');
    expect(brand.normalizedName).toBe('fanoma');
  });

  it('assertProductName preserves Persian display and builds key', () => {
    const product = assertProductName('  رژ  لب   جامد فانوما  ');
    expect(product.name).toBe('رژ لب جامد فانوما');
    expect(product.normalizedName).toBe(normalizeCatalogNameKey('رژ لب جامد فانوما'));
  });

  it('assertProductCode uppercases and validates', () => {
    expect(assertProductCode('  fan-sl  ')).toEqual({
      code: 'FAN-SL',
      normalizedCode: 'FAN-SL',
    });
    expect(() => assertProductCode('FAN SL')).toThrow(AppError);
  });

  it('rejects empty brand/category names', () => {
    expect(() => assertBrandName('   ')).toThrow(AppError);
    expect(() => assertCategoryName('')).toThrow(AppError);
  });
});

describe('category-tree.util', () => {
  const rows = [
    {
      id: 'a',
      parentId: null,
      name: 'Root',
      code: null,
      status: 'ACTIVE',
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    },
    {
      id: 'b',
      parentId: 'a',
      name: 'Child',
      code: null,
      status: 'ACTIVE',
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    },
    {
      id: 'c',
      parentId: 'b',
      name: 'Grand',
      code: null,
      status: 'ACTIVE',
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    },
  ];

  it('builds a tree without N+1 and sorts children', () => {
    const tree = buildCategoryTree(rows);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('a');
    expect(tree[0].children[0].id).toBe('b');
    expect(tree[0].children[0].children[0].id).toBe('c');
  });

  it('detects ancestor/self for cycle prevention', () => {
    const flat = rows.map(({ id, parentId }) => ({ id, parentId }));
    expect(isAncestorOrSelf(flat, 'c', 'a')).toBe(true);
    expect(isAncestorOrSelf(flat, 'a', 'c')).toBe(false);
    expect(isAncestorOrSelf(flat, 'a', 'a')).toBe(true);
  });

  it('collects descendants', () => {
    const flat = rows.map(({ id, parentId }) => ({ id, parentId }));
    expect([...collectDescendantIds(flat, 'a')].sort()).toEqual(['b', 'c']);
  });

  it('builds breadcrumb paths', () => {
    expect(buildCategoryPath(rows, 'c')).toBe('Root / Child / Grand');
  });

  it('isCategoryAssignable requires ACTIVE self and ancestors', () => {
    const flat = [
      { id: 'a', parentId: null, status: 'ARCHIVED' },
      { id: 'b', parentId: 'a', status: 'ACTIVE' },
      { id: 'c', parentId: 'b', status: 'ACTIVE' },
    ];
    expect(isCategoryAssignable(flat, 'c')).toBe(false);
    expect(isCategoryAssignable(flat, 'b')).toBe(false);
    expect(
      isCategoryAssignable([
        { id: 'a', parentId: null, status: 'ACTIVE' },
        { id: 'b', parentId: 'a', status: 'ACTIVE' },
      ], 'b'),
    ).toBe(true);
    expect(isCategoryAssignable(flat, 'missing')).toBe(false);
  });

  it('handles orphans as roots defensively', () => {
    const orphan = [
      {
        id: 'x',
        parentId: 'missing',
        name: 'Orphan',
        code: null,
        status: 'ACTIVE',
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        archivedAt: null,
      },
    ];
    const tree = buildCategoryTree(orphan);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('x');
  });
});

describe('normalizeSearchQuery', () => {
  it('folds Arabic Yeh/Kaf and collapses whitespace for Persian search', () => {
    expect(normalizeSearchQuery('  ي  ك  ', 100)).toBe('ی ک');
    expect(normalizeSearchQuery('  رژ   لب  ', 100)).toBe('رژ لب');
    expect(normalizeSearchNameKey('رژ لب')).toBe(normalizeSearchNameKey('  رژ   لب '));
  });

  it('returns undefined for blank queries', () => {
    expect(normalizeSearchQuery('   ', 100)).toBeUndefined();
    expect(normalizeSearchQuery(undefined, 100)).toBeUndefined();
  });
});
