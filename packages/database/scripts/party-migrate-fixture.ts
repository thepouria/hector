/**
 * Creates representative pre-5.5.2 unlinked domain rows, then callers run
 * `pnpm party:migrate --apply` against them.
 *
 * Usage: pnpm --filter @hector/database exec tsx scripts/party-migrate-fixture.ts
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import {
  CurrencyCode,
  CustomerStatus,
  CustomerType,
  FinanceCounterpartyType,
  LoanStatus,
  PrismaClient,
  PurchasingLifecycleStatus,
} from '../src/generated/prisma/client.js';

for (const path of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../../../.env'),
]) {
  if (existsSync(path)) {
    config({ path, quiet: true });
    break;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const company = await prisma.company.findFirstOrThrow({ where: { slug: 'pishteh' } });
    const owner = await prisma.user.findFirstOrThrow({ where: { email: 'pouria@hector.local' } });
    const stamp = Date.now();

    const supplier = await prisma.supplier.create({
      data: {
        companyId: company.id,
        name: `Legacy Mig Supplier ${stamp}`,
        phone: '09123334455',
        email: `legacy-sup-${stamp}@example.com`,
        status: PurchasingLifecycleStatus.ACTIVE,
        partyId: null,
      },
    });

    const customer = await prisma.customer.create({
      data: {
        companyId: company.id,
        type: CustomerType.INDIVIDUAL,
        displayName: `Legacy Mig Customer ${stamp}`,
        mobile: '09123334455',
        email: `legacy-cus-${stamp}@example.com`,
        status: CustomerStatus.ACTIVE,
        partyId: null,
        createdById: owner.id,
      },
    });

    const loan = await prisma.loan.create({
      data: {
        companyId: company.id,
        number: `MIG-L-${stamp}`,
        lenderType: FinanceCounterpartyType.EXTERNAL_PERSON,
        lenderName: `Legacy Mig Lender ${stamp}`,
        currency: CurrencyCode.USD,
        contractedPrincipal: '10000',
        referenceFxRate: '250000',
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: CurrencyCode.IRR,
        status: LoanStatus.DRAFT,
        createdById: owner.id,
        lenderPartyId: null,
        borrowerPartyId: null,
      },
    });

    console.log(
      JSON.stringify(
        {
          companyId: company.id,
          supplierId: supplier.id,
          customerId: customer.id,
          loanId: loan.id,
          loanPrincipal: '10000',
          loanCurrency: 'USD',
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
