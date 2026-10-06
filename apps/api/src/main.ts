import 'reflect-metadata';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { JSON_BODY_LIMIT } from './common/constants';
import { createCookieAuthOriginGuard } from './common/middleware/cookie-auth-origin.middleware';
import { noStoreApiCacheMiddleware } from './common/middleware/no-store-api-cache.middleware';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import type { AppConfig } from './config';

for (const candidate of [
  join(__dirname, '../../../.env'),
  join(process.cwd(), '.env'),
  join(process.cwd(), '../../.env'),
]) {
  loadEnv({ path: candidate, quiet: true });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  const logger = app.get(PinoNestLogger);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');

  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(noStoreApiCacheMiddleware);
  app.use(cookieParser());
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));
  app.use(createCookieAuthOriginGuard(appConfig.corsOrigins));

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', {
    exclude: ['health'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  app.enableShutdownHooks();

  if (appConfig.swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Hector API')
      .setDescription(
        'Hector Business Operating System API. Access tokens are Bearer JWTs. Refresh tokens are HttpOnly cookies (`hector_refresh`). Company-scoped routes require `X-Company-Id` after membership validation.',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('hector_refresh')
      .addApiKey(
        {
          type: 'apiKey',
          in: 'header',
          name: 'X-Company-Id',
          description: 'Active company UUID for company-scoped requests',
        },
        'company-id',
      )
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(appConfig.port);

  logger.log(`Hector API running on http://localhost:${appConfig.port}`);
  if (appConfig.swaggerEnabled) {
    logger.log(`Swagger docs at http://localhost:${appConfig.port}/api/docs`);
  }
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    error instanceof Error ? error.message : 'Failed to start Hector API',
    error instanceof Error ? error.stack : undefined,
  );
  process.exit(1);
});
