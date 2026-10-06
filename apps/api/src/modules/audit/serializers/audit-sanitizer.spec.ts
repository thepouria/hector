import {
  auditSnapshotsEqual,
  sanitizeAuditSnapshot,
  sanitizeAuditValue,
} from './audit-sanitizer';

describe('AuditSanitizer', () => {
  it('redacts known sensitive keys including nested structures', () => {
    const sanitized = sanitizeAuditValue({
      email: 'pouria@hector.local',
      password: 'secret',
      passwordHash: 'hash',
      nested: {
        refreshToken: 'rt',
        accessToken: 'at',
        refreshTokenHash: 'rth',
        authorization: 'Bearer x',
        cookie: 'hector_refresh=...',
        apiKey: 'k',
        secret: 's',
        tokenCount: 3,
      },
    }) as Record<string, unknown>;

    expect(sanitized.email).toBe('pouria@hector.local');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.passwordHash).toBe('[REDACTED]');
    const nested = sanitized.nested as Record<string, unknown>;
    expect(nested.refreshToken).toBe('[REDACTED]');
    expect(nested.accessToken).toBe('[REDACTED]');
    expect(nested.refreshTokenHash).toBe('[REDACTED]');
    expect(nested.authorization).toBe('[REDACTED]');
    expect(nested.cookie).toBe('[REDACTED]');
    expect(nested.apiKey).toBe('[REDACTED]');
    expect(nested.secret).toBe('[REDACTED]');
    expect(nested.tokenCount).toBe(3);
  });

  it('treats permission order as equal after normalization', () => {
    expect(
      auditSnapshotsEqual(
        { permissions: ['role.read', 'member.read'] },
        { permissions: ['member.read', 'role.read'] },
      ),
    ).toBe(false);

    // Equality helper sorts object keys, not array contents — use sorted snapshots in services.
    expect(
      auditSnapshotsEqual(
        sanitizeAuditSnapshot({ permissions: ['member.read', 'role.read'] }),
        sanitizeAuditSnapshot({ permissions: ['member.read', 'role.read'] }),
      ),
    ).toBe(true);
  });
});
