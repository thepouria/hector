/**
 * Read-only Reconciliation integrity checks (Phase 6.4).
 *
 * Usage:
 *   pnpm reconciliation:integrity
 *
 * Exit 0 = no hard violations. Never mutates data.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';

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

type Violation = { check: string; count: number; sample?: unknown };

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const violations: Violation[] = [];

  try {
    const counts = await prisma.$queryRaw<
      Array<{ reconciliations: number; discrepancies: number }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM reconciliations) AS reconciliations,
        (SELECT COUNT(*)::int FROM reconciliation_discrepancies) AS discrepancies
    `;

    const checks: Array<{ name: string; sql: Promise<unknown[]> }> = [
      {
        name: 'reconciliation_orphan_company',
        sql: prisma.$queryRaw`
          SELECT r.id FROM reconciliations r
          LEFT JOIN companies c ON c.id = r.company_id
          WHERE c.id IS NULL LIMIT 20`,
      },
      {
        name: 'reconciliation_resolved_without_evidence',
        sql: prisma.$queryRaw`
          SELECT id FROM reconciliations
          WHERE status = 'RESOLVED'
            AND (resolved_at IS NULL OR resolved_by_id IS NULL OR resolution_type IS NULL)
          LIMIT 20`,
      },
      {
        name: 'reconciliation_discrepancy_orphan',
        sql: prisma.$queryRaw`
          SELECT d.id FROM reconciliation_discrepancies d
          LEFT JOIN reconciliations r ON r.id = d.reconciliation_id AND r.company_id = d.company_id
          WHERE r.id IS NULL LIMIT 20`,
      },
      {
        name: 'reconciliation_cancelled_with_open_discrepancy',
        sql: prisma.$queryRaw`
          SELECT r.id FROM reconciliations r
          JOIN reconciliation_discrepancies d ON d.reconciliation_id = r.id AND d.company_id = r.company_id
          WHERE r.status = 'CANCELLED' AND d.status <> 'RESOLVED'
          LIMIT 20`,
      },
    ];

    for (const check of checks) {
      const rows = await check.sql;
      if (rows.length > 0) {
        violations.push({
          check: check.name,
          count: rows.length,
          sample: rows.slice(0, 5),
        });
      }
    }

    console.log('Reconciliation integrity summary:');
    console.log(JSON.stringify(counts[0] ?? {}, null, 2));

    if (violations.length === 0) {
      console.log('Reconciliation integrity: 0 hard violations');
      process.exit(0);
    }

    console.error('Reconciliation integrity violations:');
    for (const v of violations) {
      console.error(`- ${v.check}: ${v.count}`, v.sample ?? '');
    }
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
