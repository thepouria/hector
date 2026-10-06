import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

function loadRootEnv(): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../.env'),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      config({ path, quiet: true });
      return;
    }
  }
}

loadRootEnv();

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

export type CreatePrismaClientOptions = {
  connectionString?: string;
};

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and start PostgreSQL before using @hector/database.',
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/**
 * Returns a process-wide PrismaClient singleton.
 * NestJS DatabaseService should use this so API code does not create extra clients.
 */
export function getPrismaClient(connectionString?: string): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient({ connectionString });
  }

  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, property, receiver) as unknown;

    if (typeof value === 'function') {
      return value.bind(client);
    }

    return value;
  },
});

/** Disconnect and clear the process-wide PrismaClient singleton. */
export async function disconnectPrismaClient(): Promise<void> {
  if (!globalForPrisma.prisma) {
    return;
  }

  await globalForPrisma.prisma.$disconnect();
  globalForPrisma.prisma = undefined;
}
