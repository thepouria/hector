import { ConfigService } from '@nestjs/config';
import { RefreshTokenService } from './refresh-token.service';

function createService(pepper = ''): RefreshTokenService {
  const config = {
    get: () => ({ refreshPepper: pepper }),
  } as unknown as ConfigService;
  return new RefreshTokenService(config);
}

describe('RefreshTokenService', () => {
  it('formats and parses tokens as sessionId.secret', () => {
    const service = createService();
    const sessionId = '11111111-2222-4333-8444-555555555555';
    const secret = service.createSecret();
    const token = service.formatToken(sessionId, secret);
    const parsed = service.parseToken(token);

    expect(parsed).toEqual({ sessionId, secret });
  });

  it('hashes secrets consistently and compares safely (unpeppered)', () => {
    const service = createService();
    const secret = service.createSecret();
    const hash = service.hashSecret(secret);

    expect(service.secretsEqual(hash, secret)).toBe(true);
    expect(service.secretsEqual(hash, 'not-the-secret')).toBe(false);
    expect(hash).not.toContain(secret);
  });

  it('uses HMAC pepper when AUTH_REFRESH_PEPPER is configured', () => {
    const peppered = createService('unit-test-refresh-pepper-abcdefghijklmnopqrstuvwxyz');
    const plain = createService('');
    const secret = peppered.createSecret();

    expect(peppered.hashSecret(secret)).not.toEqual(plain.hashSecret(secret));
    expect(peppered.secretsEqual(peppered.hashSecret(secret), secret)).toBe(true);
  });

  it('rejects malformed tokens', () => {
    const service = createService();
    expect(service.parseToken('not-a-token')).toBeNull();
    expect(service.parseToken('bad.short')).toBeNull();
  });
});
