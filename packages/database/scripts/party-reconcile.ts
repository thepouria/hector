/**
 * Read-only Party ↔ Domain reconciliation (Phase 5.5.2).
 *
 * Usage:
 *   pnpm party:reconcile
 *
 * Exit 0 = clean link coverage (potential duplicates are informational).
 * Exit 1 = integrity violations (unlinked required rows, cross-company, etc.).
 * Never mutates data.
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

async function main(): Promise<void> {
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
        suppliers: number;
        suppliers_linked: number;
        customers: number;
        customers_linked: number;
        loans: number;
        loans_linked: number;
        capital: number;
        capital_linked: number;
        partners: number;
        supplier_contacts: number;
        supplier_contacts_linked: number;
        potential_dups: number;
        ambiguous: number;
      }>
    >`
      SELECT
        (SELECT COUNT(*)::int FROM suppliers) AS suppliers,
        (SELECT COUNT(*)::int FROM suppliers WHERE party_id IS NOT NULL) AS suppliers_linked,
        (SELECT COUNT(*)::int FROM customers) AS customers,
        (SELECT COUNT(*)::int FROM customers WHERE party_id IS NOT NULL) AS customers_linked,
        (SELECT COUNT(*)::int FROM loans) AS loans,
        (SELECT COUNT(*)::int FROM loans WHERE lender_party_id IS NOT NULL) AS loans_linked,
        (SELECT COUNT(*)::int FROM capital_contributions) AS capital,
        (SELECT COUNT(*)::int FROM capital_contributions WHERE contributor_party_id IS NOT NULL) AS capital_linked,
        (SELECT COUNT(*)::int FROM partners) AS partners,
        (SELECT COUNT(*)::int FROM supplier_contacts) AS supplier_contacts,
        (SELECT COUNT(*)::int FROM supplier_contacts WHERE contact_party_id IS NOT NULL) AS supplier_contacts_linked,
        (SELECT COUNT(*)::int FROM party_migration_maps WHERE match_tier = 'AMBIGUOUS_SEPARATE') AS ambiguous,
        (SELECT COUNT(*)::int FROM party_migration_maps
          WHERE match_tier = 'AMBIGUOUS_SEPARATE'
             OR notes ILIKE '%potential%') AS potential_dups
    `;

    const c = counts[0]!;

    const push = async (name: string, sql: Promise<unknown[]>) => {
      const rows = await sql;
      if (rows.length > 0) {
        violations.push({ check: name, count: rows.length, sample: rows.slice(0, 5) });
      }
    };

    await push(
      'supplier_unlinked',
      prisma.$queryRaw`SELECT id FROM suppliers WHERE party_id IS NULL LIMIT 20`,
    );
    await push(
      'customer_unlinked',
      prisma.$queryRaw`SELECT id FROM customers WHERE party_id IS NULL LIMIT 20`,
    );
    await push(
      'loan_lender_unlinked',
      prisma.$queryRaw`SELECT id FROM loans WHERE lender_party_id IS NULL LIMIT 20`,
    );
    await push(
      'capital_contributor_unlinked',
      prisma.$queryRaw`SELECT id FROM capital_contributions WHERE contributor_party_id IS NULL LIMIT 20`,
    );
    await push(
      'supplier_party_cross_company',
      prisma.$queryRaw`
        SELECT s.id FROM suppliers s
        JOIN parties p ON p.id = s.party_id
        WHERE s.party_id IS NOT NULL AND s.company_id <> p.company_id
        LIMIT 20`,
    );
    await push(
      'customer_party_cross_company',
      prisma.$queryRaw`
        SELECT c.id FROM customers c
        JOIN parties p ON p.id = c.party_id
        WHERE c.party_id IS NOT NULL AND c.company_id <> p.company_id
        LIMIT 20`,
    );
    await push(
      'loan_lender_cross_company',
      prisma.$queryRaw`
        SELECT l.id FROM loans l
        JOIN parties p ON p.id = l.lender_party_id
        WHERE l.lender_party_id IS NOT NULL AND l.company_id <> p.company_id
        LIMIT 20`,
    );
    await push(
      'loan_borrower_cross_company',
      prisma.$queryRaw`
        SELECT l.id FROM loans l
        JOIN parties p ON p.id = l.borrower_party_id
        WHERE l.borrower_party_id IS NOT NULL AND l.company_id <> p.company_id
        LIMIT 20`,
    );
    await push(
      'capital_contributor_cross_company',
      prisma.$queryRaw`
        SELECT c.id FROM capital_contributions c
        JOIN parties p ON p.id = c.contributor_party_id
        WHERE c.contributor_party_id IS NOT NULL AND c.company_id <> p.company_id
        LIMIT 20`,
    );
    await push(
      'partner_cross_company',
      prisma.$queryRaw`
        SELECT pr.id FROM partners pr
        JOIN parties p ON p.id = pr.party_id
        WHERE pr.company_id <> p.company_id
        LIMIT 20`,
    );
    await push(
      'relationship_cross_company',
      prisma.$queryRaw`
        SELECT r.id FROM party_relationships r
        JOIN parties f ON f.id = r.from_party_id
        JOIN parties t ON t.id = r.to_party_id
        WHERE r.company_id <> f.company_id OR r.company_id <> t.company_id
        LIMIT 20`,
    );

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('Party Domain Reconciliation');
    console.log('═══════════════════════════════════════════');
    console.log(`Suppliers:              ${c.suppliers}`);
    console.log(`  Linked:               ${c.suppliers_linked}`);
    console.log(`  Unlinked:             ${c.suppliers - c.suppliers_linked}`);
    console.log(`Customers:              ${c.customers}`);
    console.log(`  Linked:               ${c.customers_linked}`);
    console.log(`  Unlinked:             ${c.customers - c.customers_linked}`);
    console.log(`Finance loans:          ${c.loans}`);
    console.log(`  Lender linked:        ${c.loans_linked}`);
    console.log(`  Unlinked:             ${c.loans - c.loans_linked}`);
    console.log(`Capital contributions:  ${c.capital}`);
    console.log(`  Linked:               ${c.capital_linked}`);
    console.log(`  Unlinked:             ${c.capital - c.capital_linked}`);
    console.log(`Partner references:     ${c.partners}`);
    console.log(`Supplier contacts:      ${c.supplier_contacts}`);
    console.log(`  Linked:               ${c.supplier_contacts_linked}`);
    console.log(`Potential duplicates:   ${c.potential_dups}`);
    console.log(`Ambiguous identities:   ${c.ambiguous}`);
    console.log(`Integrity violations:   ${violations.length}`);
    console.log('═══════════════════════════════════════════');

    if (violations.length > 0) {
      for (const v of violations) {
        console.error(`FAIL ${v.check}: ${v.count}`, v.sample ?? '');
      }
      process.exit(1);
    }
    console.log('OK — reconciliation clean (potential duplicates are not violations).');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
