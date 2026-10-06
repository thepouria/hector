import { validateEnv, parseCorsOrigins } from './env.validation';

describe('validateEnv', () => {
  const validEnv = {
    NODE_ENV: 'development',
    API_PORT: '3001',
    DATABASE_URL: 'postgresql://hector:hector_dev_password@localhost:5432/hector',
    CORS_ORIGINS: 'http://localhost:3000',
    SWAGGER_ENABLED: 'true',
    LOG_LEVEL: 'info',
    JWT_ACCESS_SECRET: 'dev-only-hector-jwt-access-secret-change-me-32chars',
    JWT_ACCESS_TTL: '15m',
    AUTH_SESSION_TTL_DAYS: '30',
  };

  it('accepts a valid environment', () => {
    const parsed = validateEnv(validEnv);

    expect(parsed.API_PORT).toBe(3001);
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.DATABASE_URL).toContain('postgresql://');
    expect(parsed.JWT_ACCESS_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        DATABASE_URL: '',
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects an invalid API_PORT', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        API_PORT: '99999',
      }),
    ).toThrow(/API_PORT/);
  });

  it('rejects a short JWT secret', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        JWT_ACCESS_SECRET: 'too-short',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'staging',
      }),
    ).toThrow(/NODE_ENV/);
  });

  it('rejects production JWT secrets with placeholder markers', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'dev-only-hector-jwt-access-secret-change-me-32chars',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects CORS wildcard origins', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        CORS_ORIGINS: '*',
      }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('rejects invalid CORS origins', () => {
    expect(() => parseCorsOrigins('not-a-url')).toThrow(/invalid origin/i);
  });

  it('accepts a strong production JWT secret', () => {
    const parsed = validateEnv({
      ...validEnv,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'prod-grade-random-key-abcdefghijklmnopqrstuvwxyz012345',
      SWAGGER_ENABLED: 'true',
    });
    expect(parsed.NODE_ENV).toBe('production');
  });
});
