import {
  ATTRIBUTE_CODE_MAX_LENGTH,
  ATTRIBUTE_CODE_PATTERN,
  ATTRIBUTE_NAME_MAX_LENGTH,
  BARCODE_VALUE_MAX_LENGTH,
  BRAND_CODE_MAX_LENGTH,
  BRAND_NAME_MAX_LENGTH,
  CATALOG_ERROR_MESSAGES,
  CATEGORY_CODE_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  INTERNAL_CODE_PATTERN,
  PRODUCT_CODE_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  SKU_CODE_MAX_LENGTH,
  SKU_CODE_PATTERN,
  SKU_NAME_MAX_LENGTH,
  VARIANT_OPTION_NAME_MAX_LENGTH,
  VARIANT_VALUE_MAX_LENGTH,
} from './catalog.constants';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';

/**
 * Collapse accidental internal whitespace runs; preserve Unicode/Persian display text.
 * Do NOT case-fold product/brand/category display names.
 */
export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Uniqueness / search key for Brand and Category display names.
 * - NFKC Unicode normalization
 * - trim + collapse whitespace
 * - Arabic Yeh/Kaf → Persian Yeh/Kaf (ي→ی, ك→ک)
 * - case-fold for Latin duplicates (Essence vs essence)
 * Display `name` remains separate and un-mutated beyond trim/collapse.
 */
export function normalizeCatalogNameKey(value: string): string {
  let normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  normalized = normalized.replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9');
  return normalized.toLocaleLowerCase('en-US');
}

/**
 * Internal SKU / product / brand / category codes: trim + uppercase.
 * Avoids accidental duplicates like fan-sl-01 vs FAN-SL-01.
 */
export function normalizeInternalCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Scanner values: trim only — never uppercase or strip meaningful characters. */
export function normalizeBarcodeValue(value: string): string {
  return value.trim();
}

export function assertInternalCode(
  code: string,
  kind: 'sku' | 'product' | 'brand' | 'category',
): string {
  const normalized = normalizeInternalCode(code);
  const max =
    kind === 'sku'
      ? SKU_CODE_MAX_LENGTH
      : kind === 'product'
        ? PRODUCT_CODE_MAX_LENGTH
        : kind === 'brand'
          ? BRAND_CODE_MAX_LENGTH
          : CATEGORY_CODE_MAX_LENGTH;

  if (normalized.length === 0 || normalized.length > max) {
    throw AppError.validation(
      kind === 'sku'
        ? CATALOG_ERROR_MESSAGES.INVALID_SKU_CODE
        : kind === 'product'
          ? CATALOG_ERROR_MESSAGES.INVALID_PRODUCT_CODE
          : kind === 'brand'
            ? CATALOG_ERROR_MESSAGES.INVALID_BRAND_CODE
            : CATALOG_ERROR_MESSAGES.INVALID_CATEGORY_CODE,
    );
  }

  if (!(kind === 'sku' ? SKU_CODE_PATTERN : INTERNAL_CODE_PATTERN).test(normalized)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message:
        kind === 'sku'
          ? CATALOG_ERROR_MESSAGES.INVALID_SKU_CODE
          : kind === 'product'
            ? CATALOG_ERROR_MESSAGES.INVALID_PRODUCT_CODE
            : kind === 'brand'
              ? CATALOG_ERROR_MESSAGES.INVALID_BRAND_CODE
              : CATALOG_ERROR_MESSAGES.INVALID_CATEGORY_CODE,
      statusCode: 400,
    });
  }

  return normalized;
}

export function assertSkuCode(value: string): { code: string; normalizedCode: string } {
  const code = assertInternalCode(value, 'sku');
  return { code, normalizedCode: code };
}

export function assertSkuName(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const name = normalizeDisplayName(value);
  if (!name) return null;
  if (name.length > SKU_NAME_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  return name;
}

export function assertVariantOptionName(value: string): { name: string; normalizedName: string } {
  const name = normalizeDisplayName(value);
  if (!name || name.length > VARIANT_OPTION_NAME_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  const normalizedName = normalizeCatalogNameKey(name);
  if (!normalizedName) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  return { name, normalizedName };
}

export function assertVariantOptionValue(value: string): {
  value: string;
  normalizedValue: string;
} {
  const display = normalizeDisplayName(value);
  if (!display || display.length > VARIANT_VALUE_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  const normalizedValue = normalizeCatalogNameKey(display);
  if (!normalizedValue) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  return { value: display, normalizedValue };
}

export function assertBarcodeValue(value: string): string {
  const normalized = normalizeBarcodeValue(value);
  if (normalized.length === 0 || normalized.length > BARCODE_VALUE_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.BARCODE_EMPTY);
  }
  return normalized;
}

export function assertProductName(value: string): { name: string; normalizedName: string } {
  const name = normalizeDisplayName(value);
  if (!name || name.length > PRODUCT_NAME_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  const normalizedName = normalizeCatalogNameKey(name);
  if (!normalizedName) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  return { name, normalizedName };
}

/** Product code: trim + uppercase; stored as both `code` and `normalizedCode`. */
export function assertProductCode(value: string): { code: string; normalizedCode: string } {
  const code = assertInternalCode(value, 'product');
  return { code, normalizedCode: code };
}

export function assertBrandName(value: string): { name: string; normalizedName: string } {
  const name = normalizeDisplayName(value);
  if (!name || name.length > BRAND_NAME_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  const normalizedName = normalizeCatalogNameKey(name);
  if (!normalizedName) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  return { name, normalizedName };
}

/** Attribute codes: NFKC trim, lowercase, spaces → underscore. */
export function normalizeAttributeCode(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export function assertAttributeCode(value: string): { code: string; normalizedCode: string } {
  const code = normalizeAttributeCode(value);
  if (code.length === 0 || code.length > ATTRIBUTE_CODE_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.INVALID_ATTRIBUTE_CODE);
  }
  if (!ATTRIBUTE_CODE_PATTERN.test(code)) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: CATALOG_ERROR_MESSAGES.INVALID_ATTRIBUTE_CODE,
      statusCode: 400,
    });
  }
  return { code, normalizedCode: code };
}

export function assertAttributeName(value: string): { name: string; normalizedName: string } {
  const name = normalizeDisplayName(value);
  if (!name || name.length > ATTRIBUTE_NAME_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  const normalizedName = normalizeCatalogNameKey(name);
  if (!normalizedName) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  return { name, normalizedName };
}

export function assertCategoryName(value: string): { name: string; normalizedName: string } {
  const name = normalizeDisplayName(value);
  if (!name || name.length > CATEGORY_NAME_MAX_LENGTH) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  const normalizedName = normalizeCatalogNameKey(name);
  if (!normalizedName) {
    throw AppError.validation(CATALOG_ERROR_MESSAGES.NAME_REQUIRED);
  }
  return { name, normalizedName };
}

/**
 * Normalize a free-text Catalog search query for matching.
 * - trim + collapse whitespace
 * - NFKC
 * - Arabic Yeh/Kaf → Persian (ي→ی, ك→ک) so queries match `normalizedName` keys
 *
 * Does NOT uppercase identifiers. Callers use `toUpperCase()` separately for code fields.
 * Does NOT apply linguistic stemming.
 */
export function normalizeSearchQuery(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  let trimmed = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  trimmed = trimmed.replace(/\u064A/g, '\u06CC').replace(/\u0643/g, '\u06A9');
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw AppError.validation(`Search query must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

/** Name-key form of a search query (case-folded + Yeh/Kaf) for `normalizedName` contains. */
export function normalizeSearchNameKey(search: string): string {
  return normalizeCatalogNameKey(search);
}
