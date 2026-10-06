import { RefreshTokenService } from './refresh-token.service';

describe('RefreshTokenService', () => {
  const service = new RefreshTokenService();

  it('formats and parses tokens as sessionId.secret', () => {
    const sessionId = '11111111-2222-4333-8444-555555555555';
    const secret = service.createSecret();
    const token = service.formatToken(sessionId, secret);
    const parsed = service.parseToken(token);

    expect(parsed).toEqual({ sessionId, secret });
  });

  it('hashes secrets consistently and compares safely', () => {
    const secret = service.createSecret();
    const hash = service.hashSecret(secret);

    expect(service.secretsEqual(hash, secret)).toBe(true);
    expect(service.secretsEqual(hash, 'not-the-secret')).toBe(false);
    expect(hash).not.toContain(secret);
  });

  it('rejects malformed tokens', () => {
    expect(service.parseToken('not-a-token')).toBeNull();
    expect(service.parseToken('bad.short')).toBeNull();
  });
});
