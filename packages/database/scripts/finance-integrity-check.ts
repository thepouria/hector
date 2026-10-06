/**
 * Read-only Finance integrity checks (Phase 4.12).
 *
 * Usage from repo root:
 *   pnpm db:check:finance
 *   pnpm finance:integrity
 *
 * Exit 0 = clean; 1 = violations. Never mutates data.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  formatFinanceIntegrityReport,
  runFinanceIntegrityChecks,
} from '../src/finance-integrity';

function loadRootEnv(): void {
  for (const path of [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(__dirname, '../../../.env'),
  ]) {
    if (existsSync(path)) {
      config({ path, quiet: true });
      return;
    }
  }
}

loadRootEnv();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const summary = await runFinanceIntegrityChecks(prisma);
    const report = formatFinanceIntegrityReport(summary);
    if (summary.status === 'OK') {
      console.log(report);
      process.exit(0);
    }
    console.error(report);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
