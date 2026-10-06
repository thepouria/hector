import { Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  WAREHOUSE_ADDRESS_MAX_LENGTH,
  WAREHOUSE_CODE_MAX_LENGTH,
  WAREHOUSE_CODE_PATTERN,
  WAREHOUSE_ERROR_MESSAGES,
  WAREHOUSE_NAME_MAX_LENGTH,
  WAREHOUSE_NOTES_MAX_LENGTH,
} from './warehouse.constants';

export function normalizeWarehouseCode(value: string): string {
  return value.trim().toUpperCase();
}

export function assertWarehouseCode(value: string): string {
  const normalized = normalizeWarehouseCode(value);
  if (
    normalized.length === 0 ||
    normalized.length > WAREHOUSE_CODE_MAX_LENGTH ||
    !WAREHOUSE_CODE_PATTERN.test(normalized)
  ) {
    throw AppError.validation(WAREHOUSE_ERROR_MESSAGES.INVALID_CODE);
  }
  return normalized;
}

export function assertWarehouseName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > WAREHOUSE_NAME_MAX_LENGTH) {
    throw AppError.validation(WAREHOUSE_ERROR_MESSAGES.INVALID_NAME);
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

export function assertOptionalAddress(value: string | null | undefined): string | null {
  return assertOptionalText(value, WAREHOUSE_ADDRESS_MAX_LENGTH, WAREHOUSE_ERROR_MESSAGES.INVALID_ADDRESS);
}

export function assertOptionalNotes(value: string | null | undefined): string | null {
  return assertOptionalText(value, WAREHOUSE_NOTES_MAX_LENGTH, WAREHOUSE_ERROR_MESSAGES.INVALID_NOTES);
}

export function normalizeSearchQuery(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function mapWarehouseUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join(',')
      : String(error.meta?.target ?? '');
    if (target.includes('code') || target.includes('warehouses_company_id_code')) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_CODE_ALREADY_EXISTS,
        message: WAREHOUSE_ERROR_MESSAGES.CODE_ALREADY_EXISTS,
        statusCode: 409,
      });
    }
    if (target.includes('one_default') || target.includes('is_default') || target.includes('default')) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_DEFAULT_CONFLICT,
        message: WAREHOUSE_ERROR_MESSAGES.DEFAULT_CONFLICT,
        statusCode: 409,
      });
    }
    throw new AppError({
      code: ERROR_CODES.WAREHOUSE_DEFAULT_CONFLICT,
      message: WAREHOUSE_ERROR_MESSAGES.DEFAULT_CONFLICT,
      statusCode: 409,
    });
  }
  throw error;
}
