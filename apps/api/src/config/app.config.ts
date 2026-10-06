import { registerAs } from '@nestjs/config';
import { parseCorsOrigins } from './env.validation';

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  isProduction: boolean;
  isDevelopment: boolean;
};

export const appConfig = registerAs('app', (): AppConfig => {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];
  const swaggerEnv = process.env.SWAGGER_ENABLED;
  const isProduction = nodeEnv === 'production';

  // Production never mounts Swagger, even if SWAGGER_ENABLED is set.
  const swaggerEnabled = isProduction
    ? false
    : swaggerEnv === undefined
      ? true
      : ['true', '1'].includes(swaggerEnv);

  return {
    nodeEnv,
    port: Number(process.env.API_PORT),
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS ?? 'http://localhost:3000'),
    swaggerEnabled,
    logLevel: (process.env.LOG_LEVEL ?? 'info') as AppConfig['logLevel'],
    isProduction,
    isDevelopment: nodeEnv === 'development',
  };
});
