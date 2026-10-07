/** Phase 5.5.1 — Party Master constants. */

export const PARTY_CODE_PREFIX = 'PTY';
export const PARTY_CODE_PATTERN = /^PTY-\d{6,}$/;

export const PARTY_DISPLAY_NAME_MAX_LENGTH = 200;
export const PARTY_PERSON_NAME_MAX_LENGTH = 100;
export const PARTY_LEGAL_NAME_MAX_LENGTH = 200;
export const PARTY_TRADE_NAME_MAX_LENGTH = 200;
export const PARTY_ID_FIELD_MAX_LENGTH = 64;
export const PARTY_NOTES_MAX_LENGTH = 4000;
export const PARTY_CONTACT_VALUE_MAX_LENGTH = 255;
export const PARTY_CONTACT_LABEL_MAX_LENGTH = 100;
export const PARTY_ADDRESS_LABEL_MAX_LENGTH = 100;
export const PARTY_ADDRESS_LINE_MAX_LENGTH = 500;
export const PARTY_ADDRESS_GEO_MAX_LENGTH = 100;
export const PARTY_ADDRESS_POSTAL_MAX_LENGTH = 32;
export const PARTY_ADDRESS_RECIPIENT_MAX_LENGTH = 200;
export const PARTY_ADDRESS_NOTES_MAX_LENGTH = 1000;
export const PARTY_SEARCH_MAX_LENGTH = 200;

export const PARTY_ERROR_MESSAGES = {
  NOT_FOUND: 'Party was not found.',
  INVALID_TYPE: 'Party type is invalid.',
  INVALID_STATUS: 'Party status is invalid.',
  INVALID_DISPLAY_NAME: 'Party display name is required.',
  INVALID_INDIVIDUAL_IDENTITY: 'Individual Party requires a display name or first name.',
  INVALID_ORGANIZATION_IDENTITY: 'Organization Party requires a display name or legal name.',
  TYPE_CHANGE_FORBIDDEN: 'Party type cannot be changed after creation.',
  CODE_IMMUTABLE: 'Party code is server-owned and immutable.',
  CONTACT_NOT_FOUND: 'Party contact point was not found.',
  CONTACT_INACTIVE: 'Party contact point is inactive.',
  ADDRESS_NOT_FOUND: 'Party address was not found.',
  ADDRESS_ARCHIVED: 'Party address is archived.',
  ROLE_NOT_FOUND: 'Party role was not found.',
  ROLE_ALREADY_ACTIVE: 'An active role of this type already exists for the Party.',
  ROLE_ALREADY_INACTIVE: 'Party role is already inactive.',
  ROLE_DOMAIN_LINKED:
    'Cannot deactivate this role while an active domain relationship still exists.',
  NATIONAL_ID_CONFLICT: 'A Party with this national ID already exists in the company.',
  REGISTRATION_NUMBER_CONFLICT: 'A Party with this registration number already exists in the company.',
  PRIMARY_CONTACT_CONFLICT: 'Another primary contact of this type already exists.',
  PRIMARY_ADDRESS_CONFLICT: 'Another primary address already exists for this Party.',
  ARCHIVED_IMMUTABLE: 'Archived Party identity cannot be updated. Reactivate or create a new Party.',
  ARCHIVE_BLOCKED:
    'Party cannot be archived while active Supplier, Customer, Partner, or open Loan relationships exist.',
  INVALID_EMAIL: 'Email address is invalid.',
  INVALID_CONTACT_VALUE: 'Contact value is required.',
  INVALID_ADDRESS_LINE: 'Address line 1 is required.',
} as const;
