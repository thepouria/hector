import { Prisma } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';
import {
  PURCHASING_ERROR_MESSAGES,
  SUPPLIER_CODE_MAX_LENGTH,
  SUPPLIER_CODE_PATTERN,
  SUPPLIER_CONTACT_NAME_MAX_LENGTH,
  SUPPLIER_CONTACT_NOTES_MAX_LENGTH,
  SUPPLIER_CONTACT_ROLE_MAX_LENGTH,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_LEGAL_NAME_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
  SUPPLIER_NOTE_BODY_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
  SUPPLIER_SEARCH_MAX_LENGTH,
} from './purchasing.constants';

/** Trim + collapse whitespace; preserve Persian/Latin display text. */
export function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Phone/mobile: trim only — never strip leading zeros or coerce to number. */
export function normalizePhone(value: string): string {
  return value.trim();
}

export function normalizeSupplierCode(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeSearchQuery(
  value: string | undefined,
  maxLength = SUPPLIER_SEARCH_MAX_LENGTH,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export function assertSupplierName(value: string): string {
  const name = normalizeDisplayText(value);
  if (!name || name.length > SUPPLIER_NAME_MAX_LENGTH) {
    throw AppError.validation(PURCHASING_ERROR_MESSAGES.INVALID_SUPPLIER_NAME);
  }
  return name;
}

export function assertOptionalDisplay(
  value: string | null | undefined,
  max: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = normalizeDisplayText(value);
  if (!normalized) return null;
  if (normalized.length > max) {
    throw AppError.validation(`Value exceeds maximum length of ${max}.`);
  }
  return normalized;
}

export function assertSupplierLegalName(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, SUPPLIER_LEGAL_NAME_MAX_LENGTH);
}

export function assertSupplierCode(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const code = normalizeSupplierCode(value);
  if (!code) return null;
  if (code.length > SUPPLIER_CODE_MAX_LENGTH || !SUPPLIER_CODE_PATTERN.test(code)) {
    throw AppError.validation(PURCHASING_ERROR_MESSAGES.INVALID_SUPPLIER_CODE);
  }
  return code;
}

export function assertOptionalPhone(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const phone = normalizePhone(value);
  if (!phone) return null;
  if (phone.length > SUPPLIER_PHONE_MAX_LENGTH) {
    throw AppError.validation(`Phone exceeds maximum length of ${SUPPLIER_PHONE_MAX_LENGTH}.`);
  }
  return phone;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertOptionalEmail(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const email = value.trim();
  if (!email) return null;
  if (email.length > SUPPLIER_EMAIL_MAX_LENGTH || !EMAIL_RE.test(email)) {
    throw AppError.validation(PURCHASING_ERROR_MESSAGES.INVALID_SUPPLIER_EMAIL);
  }
  return email;
}

export function assertContactName(value: string): string {
  const name = normalizeDisplayText(value);
  if (!name || name.length > SUPPLIER_CONTACT_NAME_MAX_LENGTH) {
    throw AppError.validation(PURCHASING_ERROR_MESSAGES.INVALID_CONTACT_NAME);
  }
  return name;
}

export function assertContactRole(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, SUPPLIER_CONTACT_ROLE_MAX_LENGTH);
}

export function assertContactNotes(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, SUPPLIER_CONTACT_NOTES_MAX_LENGTH);
}

export function assertNoteBody(value: string): string {
  const body = value.trim();
  if (!body || body.length > SUPPLIER_NOTE_BODY_MAX_LENGTH) {
    throw AppError.validation(PURCHASING_ERROR_MESSAGES.INVALID_NOTE_BODY);
  }
  return body;
}

export function mapSupplierUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const joined = Array.isArray(target)
      ? target.join(',').toLowerCase()
      : String(target ?? '').toLowerCase();
    const constraint = String(error.meta?.constraint ?? '').toLowerCase();
    const haystack = `${joined} ${constraint}`;
    if (haystack.includes('one_primary') || haystack.includes('primary_active')) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PRIMARY_CONTACT_CONFLICT,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_PRIMARY_CONTACT_CONFLICT,
        statusCode: 409,
      });
    }
    // Supplier uniqueness today is company-scoped code (names are intentionally not unique).
    throw new AppError({
      code: ERROR_CODES.SUPPLIER_CODE_ALREADY_EXISTS,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_CODE_ALREADY_EXISTS,
      statusCode: 409,
    });
  }
  throw error;
}
