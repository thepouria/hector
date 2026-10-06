import { Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  FINANCIAL_ACCOUNT_BANK_NAME_MAX_LENGTH,
  FINANCIAL_ACCOUNT_CODE_MAX_LENGTH,
  FINANCIAL_ACCOUNT_CODE_PATTERN,
  FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH,
  FINANCIAL_ACCOUNT_ERROR_MESSAGES,
  FINANCIAL_ACCOUNT_IBAN_MAX_LENGTH,
  FINANCIAL_ACCOUNT_NAME_MAX_LENGTH,
  FINANCIAL_ACCOUNT_NUMBER_MAX_LENGTH,
} from './finance-accounts.constants';

export function normalizeAccountCode(value: string): string {
  return value.trim().toUpperCase();
}

export function assertAccountCode(value: string): string {
  const normalized = normalizeAccountCode(value);
  if (
    normalized.length === 0 ||
    normalized.length > FINANCIAL_ACCOUNT_CODE_MAX_LENGTH ||
    !FINANCIAL_ACCOUNT_CODE_PATTERN.test(normalized)
  ) {
    throw AppError.validation(FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_CODE);
  }
  return normalized;
}

export function assertAccountName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > FINANCIAL_ACCOUNT_NAME_MAX_LENGTH) {
    throw AppError.validation(FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_NAME);
  }
  return name;
}

export function assertOptionalText(
  value: string | null | undefined,
  maxLength: number,
  invalidMessage: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw AppError.validation(invalidMessage);
  }
  return trimmed;
}

export function assertOptionalDescription(value: string | null | undefined): string | null {
  return assertOptionalText(
    value,
    FINANCIAL_ACCOUNT_DESCRIPTION_MAX_LENGTH,
    FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_DESCRIPTION,
  );
}

export function assertOptionalBankName(value: string | null | undefined): string | null {
  return assertOptionalText(
    value,
    FINANCIAL_ACCOUNT_BANK_NAME_MAX_LENGTH,
    FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_BANK_NAME,
  );
}

export function assertOptionalAccountNumber(value: string | null | undefined): string | null {
  return assertOptionalText(
    value,
    FINANCIAL_ACCOUNT_NUMBER_MAX_LENGTH,
    FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_ACCOUNT_NUMBER,
  );
}

export function assertOptionalIban(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim().replace(/\s+/g, '').toUpperCase();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > FINANCIAL_ACCOUNT_IBAN_MAX_LENGTH) {
    throw AppError.validation(FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_IBAN);
  }
  return trimmed;
}

export function normalizeSearchQuery(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function mapFinancialAccountUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join(',')
      : String(error.meta?.target ?? '');
    if (target.includes('code') || target.includes('financial_accounts_company_id_code')) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_CODE_ALREADY_EXISTS,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.CODE_ALREADY_EXISTS,
        statusCode: 409,
      });
    }
    if (
      target.includes('one_default') ||
      target.includes('is_default') ||
      target.includes('default')
    ) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_DEFAULT_CONFLICT,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.DEFAULT_CONFLICT,
        statusCode: 409,
      });
    }
    if (target.includes('one_opening') || target.includes('opening')) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_OPENING_ALREADY_EXISTS,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.OPENING_ALREADY_EXISTS,
        statusCode: 409,
      });
    }
    if (target.includes('request_id')) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_OPENING_IDEMPOTENCY_CONFLICT,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.OPENING_IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }
  throw error;
}
