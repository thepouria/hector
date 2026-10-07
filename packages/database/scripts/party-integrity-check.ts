/**
 * Read-only Party integrity checks (Phase 5.5.1).
 *
 * Usage:
 *   pnpm db:check:party
 *   pnpm party:integrity
 *
 * Exit 0 = clean; 1 = violations. Never mutates data.
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
      Array<{
        parties: number;
        contacts: number;
        addresses: number;
        roles: number;
      }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM parties) AS parties,
        (SELECT COUNT(*)::int FROM party_contact_points) AS contacts,
        (SELECT COUNT(*)::int FROM party_addresses) AS addresses,
        (SELECT COUNT(*)::int FROM party_roles) AS roles
    `;

    const sqlChecks: Array<{ name: string; sql: Promise<unknown[]> }> = [
      {
        name: 'party_company_missing',
        sql: prisma.$queryRaw`
          SELECT p.id FROM parties p
          LEFT JOIN companies c ON c.id = p.company_id
          WHERE c.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'party_code_duplicate',
        sql: prisma.$queryRaw`
          SELECT company_id, party_code, COUNT(*)::int AS cnt
          FROM parties
          GROUP BY company_id, party_code
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'party_type_invalid_individual_fields',
        sql: prisma.$queryRaw`
          SELECT id FROM parties
          WHERE type = 'INDIVIDUAL'
            AND (legal_name IS NOT NULL OR trade_name IS NOT NULL)
          LIMIT 20`,
      },
      {
        name: 'party_type_invalid_organization_fields',
        sql: prisma.$queryRaw`
          SELECT id FROM parties
          WHERE type = 'ORGANIZATION'
            AND (first_name IS NOT NULL OR last_name IS NOT NULL OR birth_date IS NOT NULL)
          LIMIT 20`,
      },
      {
        name: 'contact_cross_company',
        sql: prisma.$queryRaw`
          SELECT c.id FROM party_contact_points c
          JOIN parties p ON p.id = c.party_id
          WHERE c.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'address_cross_company',
        sql: prisma.$queryRaw`
          SELECT a.id FROM party_addresses a
          JOIN parties p ON p.id = a.party_id
          WHERE a.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'role_cross_company',
        sql: prisma.$queryRaw`
          SELECT r.id FROM party_roles r
          JOIN parties p ON p.id = r.party_id
          WHERE r.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'orphan_contact',
        sql: prisma.$queryRaw`
          SELECT c.id FROM party_contact_points c
          LEFT JOIN parties p ON p.id = c.party_id AND p.company_id = c.company_id
          WHERE p.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'orphan_address',
        sql: prisma.$queryRaw`
          SELECT a.id FROM party_addresses a
          LEFT JOIN parties p ON p.id = a.party_id AND p.company_id = a.company_id
          WHERE p.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'orphan_role',
        sql: prisma.$queryRaw`
          SELECT r.id FROM party_roles r
          LEFT JOIN parties p ON p.id = r.party_id AND p.company_id = r.company_id
          WHERE p.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'duplicate_active_role',
        sql: prisma.$queryRaw`
          SELECT company_id, party_id, role_type, COUNT(*)::int AS cnt
          FROM party_roles
          WHERE status = 'ACTIVE'
          GROUP BY company_id, party_id, role_type
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'duplicate_primary_contact_per_type',
        sql: prisma.$queryRaw`
          SELECT company_id, party_id, type, COUNT(*)::int AS cnt
          FROM party_contact_points
          WHERE is_primary = true AND status = 'ACTIVE'
          GROUP BY company_id, party_id, type
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'duplicate_primary_address',
        sql: prisma.$queryRaw`
          SELECT company_id, party_id, COUNT(*)::int AS cnt
          FROM party_addresses
          WHERE is_primary = true AND archived_at IS NULL
          GROUP BY company_id, party_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'contact_normalized_inconsistent',
        sql: prisma.$queryRaw`
          SELECT id FROM party_contact_points
          WHERE type = 'EMAIL'
            AND normalized_value <> lower(btrim(value))
          LIMIT 20`,
      },
      {
        name: 'empty_display_name',
        sql: prisma.$queryRaw`
          SELECT id FROM parties
          WHERE btrim(display_name) = ''
          LIMIT 20`,
      },
      // Phase 5.5.2 — domain link integrity
      {
        name: 'supplier_unlinked',
        sql: prisma.$queryRaw`
          SELECT s.id FROM suppliers s
          WHERE s.party_id IS NULL
          LIMIT 20`,
      },
      {
        name: 'supplier_party_missing',
        sql: prisma.$queryRaw`
          SELECT s.id FROM suppliers s
          LEFT JOIN parties p ON p.id = s.party_id AND p.company_id = s.company_id
          WHERE s.party_id IS NOT NULL AND p.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'supplier_party_cross_company',
        sql: prisma.$queryRaw`
          SELECT s.id FROM suppliers s
          JOIN parties p ON p.id = s.party_id
          WHERE s.party_id IS NOT NULL AND s.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'supplier_missing_supplier_role',
        sql: prisma.$queryRaw`
          SELECT s.id FROM suppliers s
          WHERE s.party_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM party_roles r
              WHERE r.party_id = s.party_id
                AND r.company_id = s.company_id
                AND r.role_type = 'SUPPLIER'
                AND r.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'supplier_duplicate_party_link',
        sql: prisma.$queryRaw`
          SELECT company_id, party_id, COUNT(*)::int AS cnt
          FROM suppliers
          WHERE party_id IS NOT NULL
          GROUP BY company_id, party_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'customer_unlinked',
        sql: prisma.$queryRaw`
          SELECT c.id FROM customers c
          WHERE c.party_id IS NULL
          LIMIT 20`,
      },
      {
        name: 'customer_party_missing',
        sql: prisma.$queryRaw`
          SELECT c.id FROM customers c
          LEFT JOIN parties p ON p.id = c.party_id AND p.company_id = c.company_id
          WHERE c.party_id IS NOT NULL AND p.id IS NULL
          LIMIT 20`,
      },
      {
        name: 'customer_party_cross_company',
        sql: prisma.$queryRaw`
          SELECT c.id FROM customers c
          JOIN parties p ON p.id = c.party_id
          WHERE c.party_id IS NOT NULL AND c.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'customer_missing_customer_role',
        sql: prisma.$queryRaw`
          SELECT c.id FROM customers c
          WHERE c.party_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM party_roles r
              WHERE r.party_id = c.party_id
                AND r.company_id = c.company_id
                AND r.role_type = 'CUSTOMER'
                AND r.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'customer_duplicate_party_link',
        sql: prisma.$queryRaw`
          SELECT company_id, party_id, COUNT(*)::int AS cnt
          FROM customers
          WHERE party_id IS NOT NULL
          GROUP BY company_id, party_id
          HAVING COUNT(*) > 1
          LIMIT 20`,
      },
      {
        name: 'partner_party_cross_company',
        sql: prisma.$queryRaw`
          SELECT pr.id FROM partners pr
          JOIN parties p ON p.id = pr.party_id
          WHERE pr.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'partner_missing_partner_role',
        sql: prisma.$queryRaw`
          SELECT pr.id FROM partners pr
          WHERE pr.status = 'ACTIVE'
            AND NOT EXISTS (
              SELECT 1 FROM party_roles r
              WHERE r.party_id = pr.party_id
                AND r.company_id = pr.company_id
                AND r.role_type = 'PARTNER'
                AND r.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'loan_lender_cross_company',
        sql: prisma.$queryRaw`
          SELECT l.id FROM loans l
          JOIN parties p ON p.id = l.lender_party_id
          WHERE l.lender_party_id IS NOT NULL AND l.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'loan_borrower_cross_company',
        sql: prisma.$queryRaw`
          SELECT l.id FROM loans l
          JOIN parties p ON p.id = l.borrower_party_id
          WHERE l.borrower_party_id IS NOT NULL AND l.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'loan_lender_missing_lender_role',
        sql: prisma.$queryRaw`
          SELECT l.id FROM loans l
          WHERE l.lender_party_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM party_roles r
              WHERE r.party_id = l.lender_party_id
                AND r.company_id = l.company_id
                AND r.role_type = 'LENDER'
                AND r.status = 'ACTIVE'
            )
          LIMIT 20`,
      },
      {
        name: 'capital_contributor_cross_company',
        sql: prisma.$queryRaw`
          SELECT c.id FROM capital_contributions c
          JOIN parties p ON p.id = c.contributor_party_id
          WHERE c.contributor_party_id IS NOT NULL AND c.company_id <> p.company_id
          LIMIT 20`,
      },
      {
        name: 'relationship_self_contact_for',
        sql: prisma.$queryRaw`
          SELECT id FROM party_relationships
          WHERE type = 'CONTACT_FOR' AND from_party_id = to_party_id
          LIMIT 20`,
      },
      {
        name: 'relationship_cross_company',
        sql: prisma.$queryRaw`
          SELECT r.id FROM party_relationships r
          JOIN parties f ON f.id = r.from_party_id
          JOIN parties t ON t.id = r.to_party_id
          WHERE r.company_id <> f.company_id OR r.company_id <> t.company_id
          LIMIT 20`,
      },
    ];

    console.log('Party Integrity');
    console.log(`Parties checked: ${(counts[0]?.parties ?? 0).toLocaleString()}`);
    console.log(`Contacts checked: ${(counts[0]?.contacts ?? 0).toLocaleString()}`);
    console.log(`Addresses checked: ${(counts[0]?.addresses ?? 0).toLocaleString()}`);
    console.log(`Roles checked: ${(counts[0]?.roles ?? 0).toLocaleString()}`);
    console.log('');
    console.log('Party integrity checks:');

    for (const check of sqlChecks) {
      const rows = await check.sql;
      const count = rows.length;
      console.log(`  ${check.name}: ${count}`);
      if (count > 0) {
        violations.push({ check: check.name, count, sample: rows.slice(0, 5) });
      }
    }

    // Informational only — deprecated snapshots may lag Party after identity updates.
    const legacyNameDrift = await prisma.$queryRaw<unknown[]>`
      SELECT s.id, s.name AS legacy_name, p.display_name AS party_name
      FROM suppliers s
      JOIN parties p ON p.id = s.party_id AND p.company_id = s.company_id
      WHERE s.party_id IS NOT NULL
        AND s.name IS DISTINCT FROM p.display_name
      LIMIT 20`;
    const legacyCustomerDrift = await prisma.$queryRaw<unknown[]>`
      SELECT c.id, c.display_name AS legacy_name, p.display_name AS party_name
      FROM customers c
      JOIN parties p ON p.id = c.party_id AND p.company_id = c.company_id
      WHERE c.party_id IS NOT NULL
        AND c.display_name IS DISTINCT FROM p.display_name
      LIMIT 20`;
    console.log(
      `  legacy_supplier_name_snapshot_drift (info): ${legacyNameDrift.length}`,
    );
    console.log(
      `  legacy_customer_name_snapshot_drift (info): ${legacyCustomerDrift.length}`,
    );

    if (violations.length === 0) {
      console.log('Party integrity check: OK (0 known violations)');
      console.log('Violations: 0');
      process.exitCode = 0;
    } else {
      console.log('Party integrity check: FAILED');
      console.log(`Violations: ${violations.length}`);
      for (const v of violations) {
        console.log(`  - ${v.check}: ${v.count}`, v.sample);
      }
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
