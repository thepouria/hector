/**
 * Type-aware barcode normalization + validation (pure helpers).
 * Resolution always uses normalizedValue; display uses immutable `value`.
 */

import { BarcodeType } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { BARCODE_VALUE_MAX_LENGTH, CATALOG_ERROR_MESSAGES } from './catalog.constants';
import { validateEan13, validateEan8, validateUpcA } from './barcode-checksum.util';

/** ASCII-ish scanner-safe characters for CODE128 / INTERNAL storage. */
const ALPHANUMERIC_BARCODE_PATTERN = /^[A-Z0-9._-]+$/i;

export type NormalizedBarcode = {
  /** Preserved display value (trimmed; casing rules applied where appropriate). */
  value: string;
  /** Lookup key — company-unique. */
  normalizedValue: string;
  type: BarcodeType;
};

function stripControlAndOuterWhitespace(raw: string): string {
  // Remove scanner CR/LF/TAB and other C0 controls; trim.
  // eslint-disable-next-line no-control-regex -- intentional C0 control strip for scanner input
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function assertLength(value: string): void {
  if (!value || value.length > BARCODE_VALUE_MAX_LENGTH) {
    throw new AppError({
      code: ERROR_CODES.BARCODE_INVALID,
      message: CATALOG_ERROR_MESSAGES.BARCODE_EMPTY,
      statusCode: 400,
    });
  }
}

function assertDigits(value: string, expectedLength: number, label: string): void {
  if (!new RegExp(`^\\d{${expectedLength}}$`).test(value)) {
    throw new AppError({
      code: ERROR_CODES.BARCODE_INVALID,
      message: CATALOG_ERROR_MESSAGES.BARCODE_INVALID,
      statusCode: 400,
      details: { type: label, reason: `expected_${expectedLength}_digits` },
    });
  }
}

function assertChecksum(ok: boolean): void {
  if (!ok) {
    throw new AppError({
      code: ERROR_CODES.BARCODE_INVALID_CHECKSUM,
      message: CATALOG_ERROR_MESSAGES.BARCODE_INVALID_CHECKSUM,
      statusCode: 400,
    });
  }
}

/**
 * Normalize + validate a barcode for the requested type.
 * Does not trust client-supplied normalizedValue.
 */
export function normalizeAndValidateBarcode(
  raw: string,
  type: BarcodeType,
): NormalizedBarcode {
  const stripped = stripControlAndOuterWhitespace(raw);
  assertLength(stripped);

  switch (type) {
    case BarcodeType.EAN13: {
      const digits = stripped.replace(/\s+/g, '');
      assertDigits(digits, 13, 'EAN13');
      assertChecksum(validateEan13(digits));
      return { value: digits, normalizedValue: digits, type };
    }
    case BarcodeType.EAN8: {
      const digits = stripped.replace(/\s+/g, '');
      assertDigits(digits, 8, 'EAN8');
      assertChecksum(validateEan8(digits));
      return { value: digits, normalizedValue: digits, type };
    }
    case BarcodeType.UPC_A: {
      const digits = stripped.replace(/\s+/g, '');
      assertDigits(digits, 12, 'UPC_A');
      assertChecksum(validateUpcA(digits));
      return { value: digits, normalizedValue: digits, type };
    }
    case BarcodeType.CODE128:
    case BarcodeType.INTERNAL: {
      const upper = stripped.toUpperCase();
      if (!ALPHANUMERIC_BARCODE_PATTERN.test(upper)) {
        throw new AppError({
          code: ERROR_CODES.BARCODE_INVALID,
          message: CATALOG_ERROR_MESSAGES.BARCODE_INVALID,
          statusCode: 400,
          details: { type, reason: 'unsafe_characters' },
        });
      }
      return { value: upper, normalizedValue: upper, type };
    }
    case BarcodeType.OTHER:
    default: {
      // Trim only — do not case-fold or strip internal characters.
      return { value: stripped, normalizedValue: stripped, type: BarcodeType.OTHER };
    }
  }
}

/** Normalize a scanned value for exact lookup (tries numeric strip + uppercase variants via caller). */
export function normalizeScannedValue(raw: string): string {
  const stripped = stripControlAndOuterWhitespace(raw);
  assertLength(stripped);
  // Prefer digit-only form when the entire payload is numeric/spaces (EAN/UPC scans).
  const compact = stripped.replace(/\s+/g, '');
  if (/^\d+$/.test(compact)) {
    return compact;
  }
  // INTERNAL / CODE128 are stored uppercase.
  if (ALPHANUMERIC_BARCODE_PATTERN.test(stripped)) {
    return stripped.toUpperCase();
  }
  return stripped;
}

export type DetectedBarcodeType = {
  suggested: BarcodeType | null;
  candidates: BarcodeType[];
};

/**
 * Soft type suggestion for UI — never authoritative.
 * Backend always validates the type the client explicitly selects.
 */
export function detectBarcodeType(raw: string): DetectedBarcodeType {
  const stripped = stripControlAndOuterWhitespace(raw);
  const compact = stripped.replace(/\s+/g, '');
  const candidates: BarcodeType[] = [];

  if (/^\d{13}$/.test(compact) && validateEan13(compact)) {
    candidates.push(BarcodeType.EAN13);
  }
  if (/^\d{8}$/.test(compact) && validateEan8(compact)) {
    candidates.push(BarcodeType.EAN8);
  }
  if (/^\d{12}$/.test(compact) && validateUpcA(compact)) {
    candidates.push(BarcodeType.UPC_A);
  }
  if (ALPHANUMERIC_BARCODE_PATTERN.test(stripped) && /[A-Za-z]/.test(stripped)) {
    candidates.push(BarcodeType.CODE128);
  }
  if (candidates.length === 0 && stripped.length > 0) {
    candidates.push(BarcodeType.OTHER);
  }

  return {
    suggested: candidates[0] ?? null,
    candidates,
  };
}
