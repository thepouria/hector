import { registerAs } from '@nestjs/config';

export type DatabaseConfig = {
  url: string;
};

export const databaseConfig = registerAs('database', (): DatabaseConfig => ({
  url: process.env.DATABASE_URL ?? '',
}));
