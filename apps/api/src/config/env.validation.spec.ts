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

  const strongAccess =
    'K7mP9qR2sT4uV6wX8yZ0aB1cD3eF5gH7iJ9kL0mN2oP4qR6sT8uV0wX=';
  const strongPepper =
    'Z9yX7wV5uT3sR1qP0oN8mL6kJ4iH2gF0eD9cB7aZ5yX3wV1uT9sR7qP=';

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

  it('rejects missing CORS_ORIGINS', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        CORS_ORIGINS: '',
      }),
    ).toThrow(/CORS_ORIGINS/);
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
        AUTH_REFRESH_PEPPER: strongPepper,
        CORS_ORIGINS: 'https://hector.pishete.com',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects production JWT secrets matching env template REPLACE_WITH', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'REPLACE_WITH_LONG_RANDOM_SECRET_AT_LEAST_32_CHARS',
        AUTH_REFRESH_PEPPER: strongPepper,
        CORS_ORIGINS: 'https://hector.pishete.com',
      }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects production without AUTH_REFRESH_PEPPER', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: strongAccess,
        CORS_ORIGINS: 'https://hector.pishete.com',
      }),
    ).toThrow(/AUTH_REFRESH_PEPPER/);
  });

  it('rejects production when refresh pepper equals access secret', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: strongAccess,
        AUTH_REFRESH_PEPPER: strongAccess,
        CORS_ORIGINS: 'https://hector.pishete.com',
      }),
    ).toThrow(/independent/);
  });

  it('rejects DEV_SEED_PASSWORD in production', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: strongAccess,
        AUTH_REFRESH_PEPPER: strongPepper,
        CORS_ORIGINS: 'https://hector.pishete.com',
        DEV_SEED_PASSWORD: 'HectorDevPassword1',
      }),
    ).toThrow(/DEV_SEED_PASSWORD/);
  });

  it('rejects production CORS localhost / http', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: strongAccess,
        AUTH_REFRESH_PEPPER: strongPepper,
        CORS_ORIGINS: 'http://localhost:3000',
      }),
    ).toThrow(/CORS_ORIGINS/);
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

  it('accepts a strong production configuration', () => {
    const parsed = validateEnv({
      ...validEnv,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: strongAccess,
      AUTH_REFRESH_PEPPER: strongPepper,
      CORS_ORIGINS: 'https://hector.pishete.com',
      SWAGGER_ENABLED: 'true',
    });
    expect(parsed.NODE_ENV).toBe('production');
    expect(parsed.AUTH_REFRESH_PEPPER).toBe(strongPepper);
  });
});
