/** Keep in sync with API VARIANT_GENERATION_MAX / BULK_SKU_MAX. */
export const VARIANT_GENERATION_MAX = 250;
export const SKU_CODE_MAX_LENGTH = 64;
export const SKU_CODE_PATTERN = /^[A-Z0-9._-]+$/;

export type GeneratorOption = {
  id: string;
  name: string;
  /** Selected values only (callers pass the chosen subset). */
  values: Array<{ id: string; value: string }>;
};

export type Combination = {
  /** One value id per option (option order preserved). */
  optionValueIds: string[];
  labels: string[];
  /** 1-based position of each value within its option's selection. */
  valueIndexes: number[];
};

export function countCombinations(options: GeneratorOption[]): number {
  if (options.length === 0) return 0;
  let total = 1;
  for (const option of options) {
    if (option.values.length === 0) return 0;
    total *= option.values.length;
    // Avoid runaway numbers on pathological input.
    if (total > 1_000_000) return total;
  }
  return total;
}

/** Cartesian product; returns null when the cap would be exceeded (never generates). */
export function generateCombinations(
  options: GeneratorOption[],
  max: number = VARIANT_GENERATION_MAX,
): Combination[] | null {
  const total = countCombinations(options);
  if (total === 0) return [];
  if (total > max) return null;

  let result: Combination[] = [{ optionValueIds: [], labels: [], valueIndexes: [] }];
  for (const option of options) {
    const next: Combination[] = [];
    for (const base of result) {
      option.values.forEach((value, index) => {
        next.push({
          optionValueIds: [...base.optionValueIds, value.id],
          labels: [...base.labels, value.value],
          valueIndexes: [...base.valueIndexes, index + 1],
        });
      });
    }
    result = next;
  }
  return result;
}

export function combinationKey(optionValueIds: string[]): string {
  return [...optionValueIds].sort().join('|');
}

/** Upper-case label if it is already a valid code fragment (e.g. "01", "M"); otherwise null. */
export function sanitizeCodePart(label: string): string | null {
  const candidate = label.trim().toUpperCase().replace(/\s+/g, '-');
  return candidate && SKU_CODE_PATTERN.test(candidate) ? candidate : null;
}

export function buildSkuCode(prefix: string, combination: Combination): string {
  const parts = combination.labels.map(
    (label, i) => sanitizeCodePart(label) ?? String(combination.valueIndexes[i]).padStart(2, '0'),
  );
  const cleanPrefix = prefix.trim().toUpperCase();
  return [cleanPrefix, ...parts].filter(Boolean).join('-');
}

export function buildSkuName(options: GeneratorOption[], combination: Combination): string {
  if (options.length === 1) {
    return `${options[0].name} ${combination.labels[0]}`;
  }
  return combination.labels.join(' / ');
}

export function isValidSkuCode(code: string): boolean {
  return code.length > 0 && code.length <= SKU_CODE_MAX_LENGTH && SKU_CODE_PATTERN.test(code);
}

/** Splits pasted input on newline / comma / Persian comma / semicolon. */
export function parseValueList(raw: string): string[] {
  return raw
    .split(/[\n,،;؛]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}
