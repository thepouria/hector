import { z } from 'zod';

const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const durationSchema = z
  .string()
  .regex(/^\d+(s|m|h|d)?$/i, 'Duration must look like 15m, 900s, 1h, or 30d');

/** Markers that indicate development / template secrets (matched case-insensitively). */
export const WEAK_SECRET_MARKERS = [
  'dev-only',
  'change-me',
  'changeme',
  'example',
  'placeholder',
  'hector-jwt',
  'replace-me',
  'replace_with',
  'replace-with',
  'at_least_32',
  'at-least-32',
] as const;

function containsWeakMarker(value: string): boolean {
  const lower = value.toLowerCase();
  return WEAK_SECRET_MARKERS.some((marker) => lower.includes(marker));
}

/** Rough entropy proxy: unique character classes + length (not a substitute for CSPRNG). */
function hasAdequateSecretMaterial(value: string): boolean {
  if (value.length < 32) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) =>
    re.test(value),
  ).length;
  // Prefer openssl rand -base64 48 (typically ≥64 chars, high charset diversity).
  if (value.length >= 48) return classes >= 2;
  return classes >= 3;
}

function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseCorsOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  for (const origin of origins) {
    if (origin === '*' || origin.toLowerCase() === 'null') {
      throw new Error(
        'CORS_ORIGINS must not include "*" or "null" when credentials are enabled',
      );
    }
    if (!isHttpOrigin(origin)) {
      throw new Error(`CORS_ORIGINS contains an invalid origin: ${origin}`);
    }
  }

  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must include at least one trusted origin');
  }

  return origins;
}

function assertProductionCors(origins: string[]): void {
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.protocol !== 'https:') {
      throw new Error(
        `Production CORS_ORIGINS must use https (got ${origin}). HTTP is not allowed.`,
      );
    }
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '::1' ||
      url.hostname.endsWith('.localhost')
    ) {
      throw new Error(
        `Production CORS_ORIGINS must not include localhost/loopback (got ${origin})`,
      );
    }
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535),
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
        'DATABASE_URL must be a PostgreSQL connection string',
      ),
    // No default — callers must set explicitly (dev/.env.example provides localhost).
    CORS_ORIGINS: z.string().min(1, 'CORS_ORIGINS is required'),
    SWAGGER_ENABLED: booleanFromEnv.optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: durationSchema.default('15m'),
    /**
     * Independent secret used as HMAC pepper for refresh-token hashes.
     * Refresh tokens are opaque (not JWTs); this separates crypto material from JWT_ACCESS_SECRET.
     * Optional in development/test for session hash compatibility; required in production.
     */
    AUTH_REFRESH_PEPPER: z.string().optional(),
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default('hector_refresh'),
    DEV_SEED_PASSWORD: z.string().min(8).optional(),
  })
  .superRefine((value, ctx) => {
    let corsOrigins: string[] = [];
    try {
      corsOrigins = parseCorsOrigins(value.CORS_ORIGINS);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: error instanceof Error ? error.message : 'Invalid CORS_ORIGINS',
      });
    }

    if (value.NODE_ENV === 'production') {
      if (containsWeakMarker(value.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message:
            'Production JWT_ACCESS_SECRET must not use a development/placeholder value',
        });
      }
      if (!hasAdequateSecretMaterial(value.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message:
            'Production JWT_ACCESS_SECRET must be high-entropy (prefer: openssl rand -base64 48)',
        });
      }

      const pepper = value.AUTH_REFRESH_PEPPER ?? '';
      if (pepper.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_REFRESH_PEPPER'],
          message:
            'Production AUTH_REFRESH_PEPPER is required (≥32 chars). Generate with: openssl rand -base64 48',
        });
      } else {
        if (containsWeakMarker(pepper)) {
          ctx.addIssue({
            code: 'custom',
            path: ['AUTH_REFRESH_PEPPER'],
            message: 'Production AUTH_REFRESH_PEPPER must not use a placeholder value',
          });
        }
        if (!hasAdequateSecretMaterial(pepper)) {
          ctx.addIssue({
            code: 'custom',
            path: ['AUTH_REFRESH_PEPPER'],
            message:
              'Production AUTH_REFRESH_PEPPER must be high-entropy (prefer: openssl rand -base64 48)',
          });
        }
        if (pepper === value.JWT_ACCESS_SECRET) {
          ctx.addIssue({
            code: 'custom',
            path: ['AUTH_REFRESH_PEPPER'],
            message:
              'AUTH_REFRESH_PEPPER must be independent from JWT_ACCESS_SECRET (secret separation)',
          });
        }
      }

      if (value.DEV_SEED_PASSWORD) {
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_SEED_PASSWORD'],
          message:
            'DEV_SEED_PASSWORD must not be set in production (demo seed is forbidden)',
        });
      }

      if (corsOrigins.length > 0) {
        try {
          assertProductionCors(corsOrigins);
        } catch (error) {
          ctx.addIssue({
            code: 'custom',
            path: ['CORS_ORIGINS'],
            message: error instanceof Error ? error.message : 'Invalid production CORS_ORIGINS',
          });
        }
      }
    }
  });

export type EnvVars = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvVars {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}
