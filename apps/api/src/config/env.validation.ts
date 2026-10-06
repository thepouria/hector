import { z } from 'zod';

const booleanFromEnv = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

const durationSchema = z
  .string()
  .regex(/^\d+(s|m|h|d)?$/i, 'Duration must look like 15m, 900s, 1h, or 30d');

const WEAK_JWT_MARKERS = [
  'dev-only',
  'change-me',
  'changeme',
  'example',
  'placeholder',
  'hector-jwt',
  'replace-me',
] as const;

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
    CORS_ORIGINS: z.string().default('http://localhost:3000'),
    SWAGGER_ENABLED: booleanFromEnv.optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: durationSchema.default('15m'),
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default('hector_refresh'),
    DEV_SEED_PASSWORD: z.string().min(8).optional(),
  })
  .superRefine((value, ctx) => {
    try {
      parseCorsOrigins(value.CORS_ORIGINS);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: error instanceof Error ? error.message : 'Invalid CORS_ORIGINS',
      });
    }

    if (value.NODE_ENV === 'production') {
      const secret = value.JWT_ACCESS_SECRET.toLowerCase();
      if (WEAK_JWT_MARKERS.some((marker) => secret.includes(marker))) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_ACCESS_SECRET'],
          message:
            'Production JWT_ACCESS_SECRET must not use a development/placeholder value',
        });
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
