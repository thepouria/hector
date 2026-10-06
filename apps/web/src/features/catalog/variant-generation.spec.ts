import { describe, expect, it } from 'vitest';
import {
  buildSkuCode,
  buildSkuName,
  combinationKey,
  countCombinations,
  generateCombinations,
  isValidSkuCode,
  parseValueList,
  sanitizeCodePart,
  VARIANT_GENERATION_MAX,
  type GeneratorOption,
} from './variant-generation';

const color: GeneratorOption = {
  id: 'color',
  name: 'رنگ',
  values: [
    { id: 'c1', value: '01' },
    { id: 'c2', value: '02' },
  ],
};
const size: GeneratorOption = {
  id: 'size',
  name: 'Size',
  values: [
    { id: 's1', value: 'S' },
    { id: 's2', value: 'M' },
    { id: 's3', value: 'بزرگ' },
  ],
};

describe('variant generation', () => {
  it('counts and generates Cartesian combinations', () => {
    expect(countCombinations([color, size])).toBe(6);
    const combos = generateCombinations([color, size])!;
    expect(combos).toHaveLength(6);
    expect(combos[0].optionValueIds).toEqual(['c1', 's1']);
    expect(combos[5].optionValueIds).toEqual(['c2', 's3']);
  });

  it('returns nothing when an option has no selected values or there are no options', () => {
    expect(generateCombinations([])).toEqual([]);
    expect(generateCombinations([{ ...color, values: [] }, size])).toEqual([]);
  });

  it('refuses to generate beyond the cap', () => {
    const big: GeneratorOption = {
      id: 'x',
      name: 'X',
      values: Array.from({ length: VARIANT_GENERATION_MAX + 1 }, (_, i) => ({
        id: `v${i}`,
        value: String(i),
      })),
    };
    expect(generateCombinations([big])).toBeNull();
    expect(generateCombinations([{ ...big, values: big.values.slice(0, VARIANT_GENERATION_MAX) }]))
      .toHaveLength(VARIANT_GENERATION_MAX);
  });

  it('builds order-independent combination keys', () => {
    expect(combinationKey(['b', 'a'])).toBe(combinationKey(['a', 'b']));
  });

  it('builds codes and names', () => {
    const combos = generateCombinations([color, size])!;
    expect(buildSkuCode('fan-sl', combos[0])).toBe('FAN-SL-01-S');
    // Non-latin labels fall back to their 1-based index.
    expect(buildSkuCode('FAN', combos[2])).toBe('FAN-01-03');
    expect(buildSkuName([color], generateCombinations([color])![1])).toBe('رنگ 02');
    expect(buildSkuName([color, size], combos[0])).toBe('01 / S');
  });

  it('validates codes', () => {
    expect(sanitizeCodePart(' m l ')).toBe('M-L');
    expect(sanitizeCodePart('رنگ')).toBeNull();
    expect(isValidSkuCode('FAN.SL-01_A')).toBe(true);
    expect(isValidSkuCode('fan')).toBe(false);
    expect(isValidSkuCode('A'.repeat(65))).toBe(false);
  });

  it('parses pasted value lists', () => {
    expect(parseValueList('01, 02\n03،04;;  ')).toEqual(['01', '02', '03', '04']);
    expect(parseValueList('  ')).toEqual([]);
  });
});
