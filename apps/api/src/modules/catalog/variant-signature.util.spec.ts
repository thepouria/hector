import { AppError } from '../../common/exceptions/app.error';
import { buildVariantSignature, SIMPLE_VARIANT_SIGNATURE } from './variant-signature.util';
import { resolveVariantSelection, type VariantOptionWithValues } from './variant-selection.util';

describe('variant-signature.util', () => {
  it('returns SIMPLE for no options', () => {
    expect(buildVariantSignature([])).toBe(SIMPLE_VARIANT_SIGNATURE);
    expect(SIMPLE_VARIANT_SIGNATURE).toBe('SIMPLE');
  });

  it('is order independent', () => {
    const a = { optionId: 'o1', optionValueId: 'v1' };
    const b = { optionId: 'o2', optionValueId: 'v9' };
    expect(buildVariantSignature([a, b])).toBe(buildVariantSignature([b, a]));
    expect(buildVariantSignature([a, b])).toBe('o1:v1|o2:v9');
  });

  it('differs for different value combinations', () => {
    expect(buildVariantSignature([{ optionId: 'o1', optionValueId: 'v1' }])).not.toBe(
      buildVariantSignature([{ optionId: 'o1', optionValueId: 'v2' }]),
    );
  });
});

describe('resolveVariantSelection', () => {
  const options: VariantOptionWithValues[] = [
    {
      id: 'color',
      name: 'Color',
      values: [
        { id: 'red', value: 'Red', isActive: true },
        { id: 'blue', value: 'Blue', isActive: false },
      ],
    },
    {
      id: 'size',
      name: 'Size',
      values: [{ id: 'm', value: 'M', isActive: true }],
    },
  ];

  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (error) {
      return error instanceof AppError ? error.code : 'OTHER';
    }
    return undefined;
  };

  it('resolves SIMPLE for products without options', () => {
    expect(resolveVariantSelection([], undefined).signature).toBe('SIMPLE');
    expect(code(() => resolveVariantSelection([], ['x']))).toBe('SKU_VARIANT_VALUE_NOT_FOUND');
  });

  it('builds signature independent of request order', () => {
    const a = resolveVariantSelection(options, ['red', 'm']);
    const b = resolveVariantSelection(options, ['m', 'red']);
    expect(a.signature).toBe(b.signature);
    expect(a.signature).toBe('color:red|size:m');
  });

  it('requires exactly one value per option', () => {
    expect(code(() => resolveVariantSelection(options, ['red']))).toBe('SKU_VARIANT_INCOMPLETE');
    expect(code(() => resolveVariantSelection(options, []))).toBe('SKU_VARIANT_INCOMPLETE');
    expect(code(() => resolveVariantSelection(options, ['red', 'red']))).toBe(
      'SKU_VARIANT_DUPLICATE_OPTION',
    );
  });

  it('rejects unknown (cross-product) values', () => {
    expect(code(() => resolveVariantSelection(options, ['red', 'zzz']))).toBe(
      'SKU_VARIANT_VALUE_NOT_FOUND',
    );
  });

  it('rejects inactive values unless already assigned', () => {
    expect(code(() => resolveVariantSelection(options, ['blue', 'm']))).toBe(
      'SKU_VARIANT_VALUE_INACTIVE',
    );
    expect(resolveVariantSelection(options, ['blue', 'm'], new Set(['blue'])).signature).toBe(
      'color:blue|size:m',
    );
  });
});
