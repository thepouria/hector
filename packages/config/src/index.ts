/**
 * Shared configuration helpers for Hector workspace packages.
 * Keep this package free of business logic.
 */

export const APP_NAME = 'hector' as const;

export type AppEnvironment = 'development' | 'test' | 'production';

export function getNodeEnv(value: string | undefined = process.env.NODE_ENV): AppEnvironment {
  if (value === 'production' || value === 'test') {
    return value;
  }

  return 'development';
}
