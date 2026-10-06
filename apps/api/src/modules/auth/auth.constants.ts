export const AUTH_ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Invalid email or password.',
  UNAUTHENTICATED: 'Authentication is required.',
  INVALID_ACCESS_TOKEN: 'Access token is invalid.',
  SESSION_EXPIRED: 'Session has expired.',
  SESSION_REVOKED: 'Session has been revoked.',
  INVALID_REFRESH_TOKEN: 'Refresh token is invalid.',
} as const;

export const MAX_PASSWORD_LENGTH = 128;
/** Minimum length for password fields (login DTO). Seed passwords already require ≥8. */
export const MIN_PASSWORD_LENGTH = 8;
