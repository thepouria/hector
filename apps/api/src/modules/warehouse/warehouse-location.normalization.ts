import { Prisma, WarehouseLocationType } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  LOCATION_CODE_MAX_LENGTH,
  LOCATION_CODE_PATTERN,
  LOCATION_ERROR_MESSAGES,
  LOCATION_NAME_MAX_LENGTH,
  LOCATION_NOTES_MAX_LENGTH,
  LOCATION_TYPE_RANK,
} from './warehouse-location.constants';
import { assertOptionalNotes as assertWarehouseOptionalNotes } from './warehouse.normalization';

export function normalizeLocationCode(value: string): string {
  return value.trim().toUpperCase();
}

export function assertLocationCode(value: string): string {
  const normalized = normalizeLocationCode(value);
  if (
    normalized.length === 0 ||
    normalized.length > LOCATION_CODE_MAX_LENGTH ||
    !LOCATION_CODE_PATTERN.test(normalized)
  ) {
    throw AppError.validation(LOCATION_ERROR_MESSAGES.INVALID_CODE);
  }
  return normalized;
}

export function assertOptionalLocationName(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0) {
    return null;
  }
  if (name.length > LOCATION_NAME_MAX_LENGTH) {
    throw AppError.validation(LOCATION_ERROR_MESSAGES.INVALID_NAME);
  }
  return name;
}

export function assertOptionalLocationNotes(value: string | null | undefined): string | null {
  try {
    return assertWarehouseOptionalNotes(value);
  } catch {
    throw AppError.validation(LOCATION_ERROR_MESSAGES.INVALID_NOTES);
  }
}

export function assertLocationType(value: WarehouseLocationType): WarehouseLocationType {
  if (value === WarehouseLocationType.TRANSIT) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'TRANSIT locations are system-managed and cannot be created via the location API.',
      statusCode: 400,
    });
  }
  if (!Object.values(WarehouseLocationType).includes(value)) {
    throw AppError.validation(LOCATION_ERROR_MESSAGES.INVALID_TYPE);
  }
  return value;
}

/**
 * Reject inverted type ranks (BIN parent of ZONE).
 * Skipped levels (ZONE → SHELF) are allowed.
 */
export function assertTypeHierarchy(
  childType: WarehouseLocationType,
  parentType: WarehouseLocationType | null,
): void {
  if (parentType === null) {
    return;
  }
  if (LOCATION_TYPE_RANK[childType] < LOCATION_TYPE_RANK[parentType]) {
    throw new AppError({
      code: ERROR_CODES.WAREHOUSE_LOCATION_TYPE_INVERSION,
      message: LOCATION_ERROR_MESSAGES.TYPE_INVERSION,
      statusCode: 409,
    });
  }
}

export function mapLocationUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join(',')
      : String(error.meta?.target ?? '');
    if (target.includes('barcode')) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_BARCODE_CONFLICT,
        message: LOCATION_ERROR_MESSAGES.BARCODE_CONFLICT,
        statusCode: 409,
      });
    }
    if (target.includes('code')) {
      throw new AppError({
        code: ERROR_CODES.WAREHOUSE_LOCATION_CODE_ALREADY_EXISTS,
        message: LOCATION_ERROR_MESSAGES.CODE_ALREADY_EXISTS,
        statusCode: 409,
      });
    }
    throw new AppError({
      code: ERROR_CODES.WAREHOUSE_LOCATION_CODE_ALREADY_EXISTS,
      message: LOCATION_ERROR_MESSAGES.CODE_ALREADY_EXISTS,
      statusCode: 409,
    });
  }
  throw error;
}

export function normalizeSearchQuery(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// Re-export notes max for DTO alignment
export { LOCATION_NOTES_MAX_LENGTH };
