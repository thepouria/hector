import { PartyContactPointType, PartyType, Prisma } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES } from '../../common/constants';
import {
  PARTY_ADDRESS_GEO_MAX_LENGTH,
  PARTY_ADDRESS_LABEL_MAX_LENGTH,
  PARTY_ADDRESS_LINE_MAX_LENGTH,
  PARTY_ADDRESS_NOTES_MAX_LENGTH,
  PARTY_ADDRESS_POSTAL_MAX_LENGTH,
  PARTY_ADDRESS_RECIPIENT_MAX_LENGTH,
  PARTY_CONTACT_LABEL_MAX_LENGTH,
  PARTY_CONTACT_VALUE_MAX_LENGTH,
  PARTY_DISPLAY_NAME_MAX_LENGTH,
  PARTY_ERROR_MESSAGES,
  PARTY_ID_FIELD_MAX_LENGTH,
  PARTY_LEGAL_NAME_MAX_LENGTH,
  PARTY_NOTES_MAX_LENGTH,
  PARTY_PERSON_NAME_MAX_LENGTH,
  PARTY_SEARCH_MAX_LENGTH,
  PARTY_TRADE_NAME_MAX_LENGTH,
} from './party.constants';

/** Trim + collapse whitespace; preserve Persian/Latin display text. */
export function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeSearchQuery(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, PARTY_SEARCH_MAX_LENGTH);
}

/**
 * Phone/mobile normalization for lookup only.
 * Strips spaces, hyphens, parentheses; never coerces to number; preserves leading zeros.
 */
export function normalizePhoneForLookup(value: string): string {
  return value.trim().replace(/[\s\-()]/g, '');
}

/** Email matching is case-insensitive; no aggressive rewriting. */
export function normalizeEmailForLookup(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeContactValue(
  type: PartyContactPointType,
  value: string,
): { value: string; normalizedValue: string } {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > PARTY_CONTACT_VALUE_MAX_LENGTH) {
    throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_CONTACT_VALUE);
  }
  if (type === PartyContactPointType.EMAIL) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_EMAIL);
    }
    return { value: trimmed, normalizedValue: normalizeEmailForLookup(trimmed) };
  }
  if (
    type === PartyContactPointType.MOBILE ||
    type === PartyContactPointType.PHONE ||
    type === PartyContactPointType.WHATSAPP
  ) {
    return { value: trimmed, normalizedValue: normalizePhoneForLookup(trimmed) };
  }
  return { value: trimmed, normalizedValue: trimmed.toLowerCase() };
}

export function assertOptionalText(
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

export function assertRequiredDisplayName(value: string): string {
  const name = normalizeDisplayText(value);
  if (!name || name.length > PARTY_DISPLAY_NAME_MAX_LENGTH) {
    throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_DISPLAY_NAME);
  }
  return name;
}

export function assertPersonName(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_PERSON_NAME_MAX_LENGTH);
}

export function assertLegalName(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_LEGAL_NAME_MAX_LENGTH);
}

export function assertTradeName(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_TRADE_NAME_MAX_LENGTH);
}

export function assertIdField(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_ID_FIELD_MAX_LENGTH);
}

export function assertNotes(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > PARTY_NOTES_MAX_LENGTH) {
    throw AppError.validation(`Notes exceed maximum length of ${PARTY_NOTES_MAX_LENGTH}.`);
  }
  return trimmed;
}

export function assertContactLabel(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_CONTACT_LABEL_MAX_LENGTH);
}

export function assertAddressLine1(value: string): string {
  const line = normalizeDisplayText(value);
  if (!line || line.length > PARTY_ADDRESS_LINE_MAX_LENGTH) {
    throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_ADDRESS_LINE);
  }
  return line;
}

export function assertAddressOptionalLine(
  value: string | null | undefined,
): string | null | undefined {
  return assertOptionalText(value, PARTY_ADDRESS_LINE_MAX_LENGTH);
}

export function assertAddressGeo(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_ADDRESS_GEO_MAX_LENGTH);
}

export function assertAddressLabel(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_ADDRESS_LABEL_MAX_LENGTH);
}

export function assertAddressPostal(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_ADDRESS_POSTAL_MAX_LENGTH);
}

export function assertAddressRecipient(
  value: string | null | undefined,
): string | null | undefined {
  return assertOptionalText(value, PARTY_ADDRESS_RECIPIENT_MAX_LENGTH);
}

export function assertAddressNotes(value: string | null | undefined): string | null | undefined {
  return assertOptionalText(value, PARTY_ADDRESS_NOTES_MAX_LENGTH);
}

/**
 * Deterministic displayName resolution (PARTY display semantics).
 * INDIVIDUAL: explicit displayName → else firstName + lastName → else firstName.
 * ORGANIZATION: explicit displayName → else tradeName → else legalName.
 */
export function resolveDisplayName(input: {
  type: PartyType;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
}): string {
  const explicit = input.displayName ? normalizeDisplayText(input.displayName) : '';
  if (explicit) {
    if (explicit.length > PARTY_DISPLAY_NAME_MAX_LENGTH) {
      throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_DISPLAY_NAME);
    }
    return explicit;
  }

  if (input.type === PartyType.INDIVIDUAL) {
    const first = input.firstName ? normalizeDisplayText(input.firstName) : '';
    const last = input.lastName ? normalizeDisplayText(input.lastName) : '';
    const composed = [first, last].filter(Boolean).join(' ');
    if (!composed) {
      throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_INDIVIDUAL_IDENTITY);
    }
    if (composed.length > PARTY_DISPLAY_NAME_MAX_LENGTH) {
      throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_DISPLAY_NAME);
    }
    return composed;
  }

  const trade = input.tradeName ? normalizeDisplayText(input.tradeName) : '';
  if (trade) {
    if (trade.length > PARTY_DISPLAY_NAME_MAX_LENGTH) {
      throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_DISPLAY_NAME);
    }
    return trade;
  }
  const legal = input.legalName ? normalizeDisplayText(input.legalName) : '';
  if (!legal) {
    throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_ORGANIZATION_IDENTITY);
  }
  if (legal.length > PARTY_DISPLAY_NAME_MAX_LENGTH) {
    throw AppError.validation(PARTY_ERROR_MESSAGES.INVALID_DISPLAY_NAME);
  }
  return legal;
}

export function mapPartyUniqueViolation(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const joined = Array.isArray(target)
      ? target.join(',').toLowerCase()
      : String(target ?? '').toLowerCase();
    const constraint = String(error.meta?.constraint ?? '').toLowerCase();
    const haystack = `${joined} ${constraint}`;

    if (haystack.includes('national_id')) {
      throw new AppError({
        code: ERROR_CODES.PARTY_NATIONAL_ID_CONFLICT,
        message: PARTY_ERROR_MESSAGES.NATIONAL_ID_CONFLICT,
        statusCode: 409,
      });
    }
    if (haystack.includes('registration_number')) {
      throw new AppError({
        code: ERROR_CODES.PARTY_REGISTRATION_NUMBER_CONFLICT,
        message: PARTY_ERROR_MESSAGES.REGISTRATION_NUMBER_CONFLICT,
        statusCode: 409,
      });
    }
    if (haystack.includes('party_code')) {
      throw new AppError({
        code: ERROR_CODES.PARTY_CODE_CONFLICT,
        message: 'Party code conflict.',
        statusCode: 409,
      });
    }
    if (
      haystack.includes('party_contact_one_primary') ||
      haystack.includes('contact_one_primary') ||
      (haystack.includes('is_primary') && haystack.includes('party_contact'))
    ) {
      throw new AppError({
        code: ERROR_CODES.PARTY_PRIMARY_CONTACT_CONFLICT,
        message: PARTY_ERROR_MESSAGES.PRIMARY_CONTACT_CONFLICT,
        statusCode: 409,
      });
    }
    if (
      haystack.includes('party_address_one_primary') ||
      haystack.includes('address_one_primary')
    ) {
      throw new AppError({
        code: ERROR_CODES.PARTY_PRIMARY_ADDRESS_CONFLICT,
        message: PARTY_ERROR_MESSAGES.PRIMARY_ADDRESS_CONFLICT,
        statusCode: 409,
      });
    }
    if (
      haystack.includes('party_role_one_active') ||
      haystack.includes('role_one_active')
    ) {
      throw new AppError({
        code: ERROR_CODES.PARTY_ROLE_ALREADY_ACTIVE,
        message: PARTY_ERROR_MESSAGES.ROLE_ALREADY_ACTIVE,
        statusCode: 409,
      });
    }
    // Fallback for Partial unique index P2002 without recognizable target metadata.
    throw new AppError({
      code: ERROR_CODES.CONFLICT,
      message: 'The requested resource conflicts with an existing record.',
      statusCode: 409,
    });
  }
  throw error;
}
