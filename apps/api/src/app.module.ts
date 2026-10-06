import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { appConfig, authConfig, databaseConfig, validateEnv, type AppConfig } from './config';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { getRequestContext } from './common/context/request-context';
import { DatabaseModule } from './infrastructure/database/database.module';
import { EventsModule } from './infrastructure/events/events.module';
import { HealthModule } from './infrastructure/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { PurchasingModule } from './modules/purchasing/purchasing.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { FinanceModule } from './modules/finance/finance.module';
import type { RequestWithId } from './common/middleware/request-id.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [
        join(__dirname, '../../../.env'),
        join(process.cwd(), '.env'),
        join(process.cwd(), '../../.env'),
      ],
      load: [appConfig, databaseConfig, authConfig],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const app = configService.getOrThrow<AppConfig>('app');

        return {
          pinoHttp: {
            level: app.logLevel,
            genReqId: (req: RequestWithId) => req.requestId ?? req.id,
            customProps: (req: RequestWithId) => {
              const ctx = getRequestContext();
              return {
                requestId: req.requestId ?? req.id,
                userId: ctx?.userId,
                sessionId: ctx?.sessionId,
                companyId: ctx?.companyId,
              };
            },
            transport: app.isDevelopment
              ? {
                  target: 'pino-pretty',
                  options: {
                    singleLine: true,
                    colorize: true,
                  },
                }
              : undefined,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["set-cookie"]',
                'res.headers["set-cookie"]',
                'DATABASE_URL',
                'database.url',
                'password',
                'passwordHash',
                'refreshToken',
                'refreshTokenHash',
                'accessToken',
                'JWT_ACCESS_SECRET',
              ],
              remove: true,
            },
            autoLogging: {
              ignore: (req) => {
                const url = req.url ?? '';
                return url === '/health' || url.startsWith('/health?');
              },
            },
            serializers: {
              req(req: { id?: string; method?: string; url?: string }) {
                return {
                  id: req.id,
                  method: req.method,
                  url: req.url,
                };
              },
            },
          },
        };
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 120,
        },
      ],
    }),
    DatabaseModule,
    EventsModule,
    HealthModule,
    AuthModule,
    CompaniesModule,
    RbacModule,
    AuditModule,
    CatalogModule,
    PurchasingModule,
    WarehouseModule,
    FinanceModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
