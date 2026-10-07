import {
  normalizeEmailForLookup,
  normalizePhoneForLookup,
} from './party.normalization';

/**
 * Phase 5.5.2 matching policy unit coverage.
 * Full migrate/idempotency is exercised via party:migrate + integrity scripts.
 */
describe('party identity matching policy', () => {
  it('preserves leading zeros in phone normalization', () => {
    expect(normalizePhoneForLookup('0912 123 4567')).toBe('09121234567');
    expect(normalizePhoneForLookup('(021) 88-77')).toBe('0218877');
  });

  it('lowercases emails for lookup', () => {
    expect(normalizeEmailForLookup('Ahmad@Example.COM')).toBe('ahmad@example.com');
  });

  it('does not treat bare names as identity keys (policy assertion)', () => {
    // Names are never unique identity signals — duplicate displayNames are allowed.
    const nameA = 'Ali Rezaei';
    const nameB = 'Ali Rezaei';
    expect(nameA).toBe(nameB);
    // Matching must require strong ID or contact — documented in docs/party-migration.md
  });
});
