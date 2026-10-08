import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';

// Must run before dotenv + AppModule/AuthController so @Throttle test limits apply.
// .env sets NODE_ENV=development; that must not win for e2e.
process.env.NODE_ENV = 'test';
process.env.SWAGGER_ENABLED = 'false';

for (const candidate of [
  join(__dirname, '../../../../.env'),
  join(process.cwd(), '.env'),
  join(process.cwd(), '../../.env'),
]) {
  loadEnv({ path: candidate, quiet: true });
}

// Re-assert after dotenv (which may overwrite NODE_ENV from .env).
process.env.NODE_ENV = 'test';
process.env.SWAGGER_ENABLED = 'false';

import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import {
  CanActivate,
  ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { JSON_BODY_LIMIT } from '../../src/common/constants';
import { createCookieAuthOriginGuard } from '../../src/common/middleware/cookie-auth-origin.middleware';
import { noStoreApiCacheMiddleware } from '../../src/common/middleware/no-store-api-cache.middleware';
import { requestIdMiddleware } from '../../src/common/middleware/request-id.middleware';
import { parseCorsOrigins } from '../../src/config/env.validation';

/** Pass-through guard so e2e suites are not flaky under Throttler 429s. */
class E2eNoopThrottlerGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}

/**
 * Shared Nest bootstrap for e2e suites. Mirrors production middleware that security tests depend on.
 */
export async function createE2eApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideGuard(ThrottlerGuard)
    .useClass(E2eNoopThrottlerGuard)
    .compile();

  const app = moduleRef.createNestApplication({
    bodyParser: false,
    bufferLogs: true,
  });

  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS ?? 'http://localhost:3000');

  app.use(requestIdMiddleware);
  app.use(noStoreApiCacheMiddleware);
  app.use(cookieParser());
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  app.use(createCookieAuthOriginGuard(corsOrigins));
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  await app.init();
  return app;
}

export function extractRefreshCookie(setCookie: string[] | undefined): string | undefined {
  if (!setCookie) return undefined;
  const match = setCookie.find((value) => value.startsWith('hector_refresh='));
  return match?.split(';')[0];
}

/** Trusted web origin for cookie-auth CSRF tests (matches CORS_ORIGINS). */
export function e2eTrustedOrigin(): string {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',')[0]!.trim();
}

export const E2E_PASSWORD = process.env.DEV_SEED_PASSWORD ?? 'HectorDevPassword1';
