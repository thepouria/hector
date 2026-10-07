/**
 * Shared Party identity matching rules (Phase 5.5.2).
 * Used by party:migrate and mirrored by API PartyIdentityLookupService.
 *
 * TIER 1 — Strong exact identity (nationalId / registrationNumber / taxId)
 * TIER 2 — Contact match (normalized mobile/email/phone)
 * TIER 3 — Name-only → NEVER auto-merge (AMBIGUOUS_SEPARATE)
 */

export type PartyMatchTier =
  | 'STRONG_IDENTITY'
  | 'CONTACT_MATCH'
  | 'AMBIGUOUS_SEPARATE'
  | 'CREATED_NEW'
  | 'EXPLICIT_LINK';

export function normalizePhoneForLookup(value: string): string {
  return value.trim().replace(/[\s\-()]/g, '');
}

export function normalizeEmailForLookup(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeIdField(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Deterministic address fingerprint for idempotent address migration. */
export function addressFingerprint(input: {
  type: string;
  addressLine1: string;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string {
  const parts = [
    input.type,
    normalizeDisplayName(input.addressLine1).toLowerCase(),
    (input.addressLine2 ?? '').trim().toLowerCase(),
    (input.city ?? '').trim().toLowerCase(),
    (input.province ?? '').trim().toLowerCase(),
    (input.postalCode ?? '').trim().toLowerCase(),
    (input.country ?? '').trim().toLowerCase(),
  ];
  return parts.join('|');
}

export type StrongIdentityInput = {
  nationalId?: string | null;
  registrationNumber?: string | null;
  taxId?: string | null;
};

export type ContactIdentityInput = {
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
};

export function hasStrongIdentity(input: StrongIdentityInput): boolean {
  return Boolean(
    normalizeIdField(input.nationalId) ||
      normalizeIdField(input.registrationNumber) ||
      normalizeIdField(input.taxId),
  );
}

export function hasContactIdentity(input: ContactIdentityInput): boolean {
  return Boolean(
    (input.mobile && normalizePhoneForLookup(input.mobile)) ||
      (input.phone && normalizePhoneForLookup(input.phone)) ||
      (input.email && normalizeEmailForLookup(input.email)),
  );
}
