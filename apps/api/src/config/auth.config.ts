import { registerAs } from '@nestjs/config';

export type AuthConfig = {
  jwtAccessSecret: string;
  /** HMAC pepper for opaque refresh-token secret hashes (independent of JWT secret). */
  refreshPepper: string;
  jwtAccessTtl: string;
  jwtAccessTtlSeconds: number;
  sessionTtlDays: number;
  sessionTtlMs: number;
  refreshCookieName: string;
  refreshCookiePath: string;
  refreshCookieSecure: boolean;
  refreshCookieSameSite: 'lax' | 'strict' | 'none';
};

function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)(s|m|h|d)?$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 60 * 60;
    case 'd':
      return amount * 60 * 60 * 24;
    default:
      throw new Error(`Invalid duration unit: ${value}`);
  }
}

export const authConfig = registerAs('auth', (): AuthConfig => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const jwtAccessTtl = process.env.JWT_ACCESS_TTL ?? '15m';
  const sessionTtlDays = Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30);

  return {
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    refreshPepper: process.env.AUTH_REFRESH_PEPPER ?? '',
    jwtAccessTtl,
    jwtAccessTtlSeconds: parseDurationToSeconds(jwtAccessTtl),
    sessionTtlDays,
    sessionTtlMs: sessionTtlDays * 24 * 60 * 60 * 1000,
    refreshCookieName: process.env.AUTH_REFRESH_COOKIE_NAME ?? 'hector_refresh',
    refreshCookiePath: '/api/v1/auth',
    refreshCookieSecure: nodeEnv === 'production',
    refreshCookieSameSite: 'lax',
  };
});
