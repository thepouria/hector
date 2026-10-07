import { Prisma } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';
import {
  CUSTOMER_ADDRESS_CITY_MAX_LENGTH,
  CUSTOMER_ADDRESS_LABEL_MAX_LENGTH,
  CUSTOMER_ADDRESS_LINE_MAX_LENGTH,
  CUSTOMER_ADDRESS_NOTES_MAX_LENGTH,
  CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH,
  CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH,
  CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH,
  CUSTOMER_BUSINESS_NAME_MAX_LENGTH,
  CUSTOMER_CODE_MAX_LENGTH,
  CUSTOMER_CODE_PATTERN,
  CUSTOMER_DISPLAY_NAME_MAX_LENGTH,
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_ID_FIELD_MAX_LENGTH,
  CUSTOMER_NOTES_MAX_LENGTH,
  CUSTOMER_PERSON_NAME_MAX_LENGTH,
  CUSTOMER_PHONE_MAX_LENGTH,
  CUSTOMER_SEARCH_MAX_LENGTH,
  SALES_CHANNEL_CODE_MAX_LENGTH,
  SALES_CHANNEL_CODE_PATTERN,
  SALES_CHANNEL_NAME_MAX_LENGTH,
  SALES_CHANNEL_NOTES_MAX_LENGTH,
  SALES_CHANNEL_SEARCH_MAX_LENGTH,
  SALES_ERROR_MESSAGES,
} from './sales.constants';

/** Trim + collapse whitespace; preserve Persian/Latin display text. */
export function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Phone/mobile: trim only — never strip leading zeros or coerce to number. */
export function normalizePhone(value: string): string {
  return value.trim();
}

export function normalizeSalesCode(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeSearchQuery(
  value: string | undefined,
  maxLength = SALES_CHANNEL_SEARCH_MAX_LENGTH,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export function normalizeCustomerSearchQuery(value: string | undefined): string | undefined {
  return normalizeSearchQuery(value, CUSTOMER_SEARCH_MAX_LENGTH);
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

export function assertSalesChannelName(value: string): string {
  const name = normalizeDisplayText(value);
  if (!name || name.length > SALES_CHANNEL_NAME_MAX_LENGTH) {
    throw AppError.validation(SALES_ERROR_MESSAGES.INVALID_SALES_CHANNEL_NAME);
  }
  return name;
}

export function assertSalesChannelCode(value: string): string {
  const code = normalizeSalesCode(value);
  if (
    !code ||
    code.length > SALES_CHANNEL_CODE_MAX_LENGTH ||
    !SALES_CHANNEL_CODE_PATTERN.test(code)
  ) {
    throw AppError.validation(SALES_ERROR_MESSAGES.INVALID_SALES_CHANNEL_CODE);
  }
  return code;
}

export function assertSalesChannelNotes(
  value: string | null | undefined,
): string | null | undefined {
  return assertOptionalDisplay(value, SALES_CHANNEL_NOTES_MAX_LENGTH);
}

export function assertCustomerDisplayName(value: string): string {
  const name = normalizeDisplayText(value);
  if (!name || name.length > CUSTOMER_DISPLAY_NAME_MAX_LENGTH) {
    throw AppError.validation(SALES_ERROR_MESSAGES.INVALID_CUSTOMER_DISPLAY_NAME);
  }
  return name;
}

export function assertCustomerCode(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const code = normalizeSalesCode(value);
  if (!code) return null;
  if (code.length > CUSTOMER_CODE_MAX_LENGTH || !CUSTOMER_CODE_PATTERN.test(code)) {
    throw AppError.validation(SALES_ERROR_MESSAGES.INVALID_CUSTOMER_CODE);
  }
  return code;
}

export function assertOptionalPhone(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const phone = normalizePhone(value);
  if (!phone) return null;
  if (phone.length > CUSTOMER_PHONE_MAX_LENGTH) {
    throw AppError.validation(`Phone exceeds maximum length of ${CUSTOMER_PHONE_MAX_LENGTH}.`);
  }
  return phone;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function assertOptionalEmail(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const email = value.trim();
  if (!email) return null;
  if (email.length > CUSTOMER_EMAIL_MAX_LENGTH || !EMAIL_RE.test(email)) {
    throw AppError.validation(SALES_ERROR_MESSAGES.INVALID_CUSTOMER_EMAIL);
  }
  return email;
}

export function assertPersonName(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_PERSON_NAME_MAX_LENGTH);
}

export function assertBusinessName(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_BUSINESS_NAME_MAX_LENGTH);
}

export function assertIdField(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_ID_FIELD_MAX_LENGTH);
}

export function assertCustomerNotes(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_NOTES_MAX_LENGTH);
}

export function assertAddressLabel(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_ADDRESS_LABEL_MAX_LENGTH);
}

export function assertAddressRecipient(
  value: string | null | undefined,
): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_ADDRESS_RECIPIENT_MAX_LENGTH);
}

export function assertAddressLine(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_ADDRESS_LINE_MAX_LENGTH);
}

export function assertAddressCity(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_ADDRESS_CITY_MAX_LENGTH);
}

export function assertAddressProvince(
  value: string | null | undefined,
): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_ADDRESS_PROVINCE_MAX_LENGTH);
}

export function assertAddressPostal(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_ADDRESS_POSTAL_MAX_LENGTH);
}

export function assertAddressNotes(value: string | null | undefined): string | null | undefined {
  return assertOptionalDisplay(value, CUSTOMER_ADDRESS_NOTES_MAX_LENGTH);
}

/**
 * Clear other defaults then set the target address as default inside a transaction.
 * Relies on partial unique index for concurrency safety.
 */
export async function setDefaultCustomerAddressInTx(
  tx: Prisma.TransactionClient,
  input: { companyId: string; customerId: string; addressId: string },
): Promise<void> {
  await tx.customerAddress.updateMany({
    where: {
      companyId: input.companyId,
      customerId: input.customerId,
      isDefault: true,
      archivedAt: null,
      NOT: { id: input.addressId },
    },
    data: { isDefault: false },
  });
  await tx.customerAddress.update({
    where: { id: input.addressId },
    data: { isDefault: true },
  });
}

export function mapSalesUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const joined = Array.isArray(target)
      ? target.join(',').toLowerCase()
      : String(target ?? '').toLowerCase();
    const constraint = String(error.meta?.constraint ?? '').toLowerCase();
    const haystack = `${joined} ${constraint}`;

    if (haystack.includes('one_default') || haystack.includes('default_active')) {
      throw new AppError({
        code: ERROR_CODES.CUSTOMER_DEFAULT_ADDRESS_CONFLICT,
        message: SALES_ERROR_MESSAGES.CUSTOMER_DEFAULT_ADDRESS_CONFLICT,
        statusCode: 409,
      });
    }
    if (haystack.includes('sales_channel') || haystack.includes('sales_channels')) {
      throw new AppError({
        code: ERROR_CODES.SALES_CHANNEL_CODE_ALREADY_EXISTS,
        message: SALES_ERROR_MESSAGES.SALES_CHANNEL_CODE_ALREADY_EXISTS,
        statusCode: 409,
      });
    }
    throw new AppError({
      code: ERROR_CODES.CUSTOMER_CODE_ALREADY_EXISTS,
      message: SALES_ERROR_MESSAGES.CUSTOMER_CODE_ALREADY_EXISTS,
      statusCode: 409,
    });
  }
  throw error;
}
