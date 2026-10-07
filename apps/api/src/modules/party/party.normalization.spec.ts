import { PartyContactPointType, PartyType } from '@hector/database';
import {
  normalizeContactValue,
  normalizePhoneForLookup,
  resolveDisplayName,
} from './party.normalization';

describe('party normalization', () => {
  it('preserves leading zeros in phone values', () => {
    const { value, normalizedValue } = normalizeContactValue(
      PartyContactPointType.MOBILE,
      '0912 123-4567',
    );
    expect(value).toBe('0912 123-4567');
    expect(normalizedValue).toBe('09121234567');
    expect(normalizePhoneForLookup('(021) 8877-6655')).toBe('02188776655');
  });

  it('normalizes email case-insensitively without rewriting local part structure', () => {
    const { value, normalizedValue } = normalizeContactValue(
      PartyContactPointType.EMAIL,
      'Ahmad.Rezaei@Example.COM',
    );
    expect(value).toBe('Ahmad.Rezaei@Example.COM');
    expect(normalizedValue).toBe('ahmad.rezaei@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => normalizeContactValue(PartyContactPointType.EMAIL, 'not-an-email')).toThrow();
  });

  it('resolves individual display name from first+last when displayName omitted', () => {
    expect(
      resolveDisplayName({
        type: PartyType.INDIVIDUAL,
        firstName: 'احمد',
        lastName: 'رضایی',
      }),
    ).toBe('احمد رضایی');
  });

  it('resolves organization display name from trade then legal', () => {
    expect(
      resolveDisplayName({
        type: PartyType.ORGANIZATION,
        legalName: 'ABC Trading LLC',
        tradeName: 'ABC Trading',
      }),
    ).toBe('ABC Trading');
    expect(
      resolveDisplayName({
        type: PartyType.ORGANIZATION,
        legalName: 'ABC Trading LLC',
      }),
    ).toBe('ABC Trading LLC');
  });

  it('allows same display names conceptually (no uniqueness enforced here)', () => {
    const a = resolveDisplayName({ type: PartyType.INDIVIDUAL, displayName: 'Ahmad' });
    const b = resolveDisplayName({ type: PartyType.INDIVIDUAL, displayName: 'Ahmad' });
    expect(a).toBe(b);
  });
});
