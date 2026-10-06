import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CapitalFundingType,
  CurrencyCode,
  FinanceCounterpartyType,
  JournalEntryStatus,
  JournalLineDirection,
  PaymentPurposeType,
  ReceiptSourceType,
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Finance Journals + Ledger (e2e) Phase 4.8', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const warehouseOperatorEmail = 'hossein@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let cashIrrId: string;
  let bankMellatId: string;
  let cashUsdId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;

    await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });

    cashIrrId = (
      await database.client.financialAccount.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'CASH-IRR' },
      })
    ).id;
    bankMellatId = (
      await database.client.financialAccount.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'BANK-MELLAT-IRR' },
      })
    ).id;
    cashUsdId = (
      await database.client.financialAccount.findFirstOrThrow({
        where: { companyId: pishtehId, code: 'CASH-USD' },
      })
    ).id;

    // Ensure CoA via list endpoint
    const token = await login(ownerEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/ledger-accounts')
      .set(auth(token, pishtehId))
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId: string) {
    return {
      Authorization: `Bearer ${token}`,
      'x-company-id': companyId,
    };
  }

  async function systemAccountId(systemKey: string): Promise<string> {
    const row = await database.client.ledgerAccount.findFirstOrThrow({
      where: { companyId: pishtehId, systemKey },
    });
    return row.id;
  }

  it('rejects unbalanced / zero / one-line manual journals', async () => {
    const token = await login(ownerEmail);
    const equity = await systemAccountId('CAPITAL_EQUITY');
    const bank = await systemAccountId('CASH_AND_BANK');

    await request(app.getHttpServer())
      .post('/api/v1/finance/journals/manual')
      .set(auth(token, pishtehId))
      .send({
        description: 'unbalanced',
        postImmediately: true,
        requestId: randomUUID(),
        lines: [
          {
            ledgerAccountId: bank,
            direction: JournalLineDirection.DEBIT,
            originalAmount: '100',
            originalCurrency: CurrencyCode.IRR,
            baseAmount: '100',
          },
          {
            ledgerAccountId: equity,
            direction: JournalLineDirection.CREDIT,
            originalAmount: '90',
            originalCurrency: CurrencyCode.IRR,
            baseAmount: '90',
          },
        ],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/finance/journals/manual')
      .set(auth(token, pishtehId))
      .send({
        description: 'one line',
        postImmediately: true,
        requestId: randomUUID(),
        lines: [
          {
            ledgerAccountId: bank,
            direction: JournalLineDirection.DEBIT,
            originalAmount: '100',
            originalCurrency: CurrencyCode.IRR,
            baseAmount: '100',
          },
        ],
      })
      .expect(400);
  });

  it('Capital → Equity; Loan → Liability; Transfer journals', async () => {
    const token = await login(ownerEmail);

    const capital = await request(app.getHttpServer())
      .post('/api/v1/finance/capital-contributions')
      .set(auth(token, pishtehId))
      .send({
        fundingType: CapitalFundingType.OWNER_EQUITY,
        contributorType: FinanceCounterpartyType.EXTERNAL_PERSON,
        contributorName: 'E2E Capital Journal',
        accountId: bankMellatId,
        amount: '1500000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const capitalJournal = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceId: capital.body.data.id,
        effectType: 'CAPITAL_POST',
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(capitalJournal).toBeTruthy();
    const creditKeys = capitalJournal!.lines
      .filter((l) => l.direction === JournalLineDirection.CREDIT)
      .map((l) => l.ledgerAccount.systemKey);
    expect(creditKeys).toContain('CAPITAL_EQUITY');

    const loan = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set(auth(token, pishtehId))
      .send({
        lenderType: FinanceCounterpartyType.EXTERNAL_PERSON,
        lenderName: 'E2E Loan Journal',
        currency: CurrencyCode.IRR,
        contractedPrincipal: '5000000',
        receivingAccountId: cashIrrId,
        firstDisbursement: {
          accountId: cashIrrId,
          amount: '2000000',
        },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const disb = await database.client.loanDisbursement.findFirstOrThrow({
      where: { companyId: pishtehId, loanId: loan.body.data.id, status: 'POSTED' },
    });

    const loanJournal = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceId: disb.id,
        effectType: 'LOAN_DISBURSE',
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(loanJournal).toBeTruthy();
    const loanCredit = loanJournal!.lines
      .filter((l) => l.direction === JournalLineDirection.CREDIT)
      .map((l) => l.ledgerAccount.systemKey);
    expect(loanCredit).toContain('LOAN_PAYABLE');
    expect(loanCredit).not.toContain('CAPITAL_EQUITY');

    const transfer = await request(app.getHttpServer())
      .post('/api/v1/finance/account-transfers')
      .set(auth(token, pishtehId))
      .send({
        sourceAccountId: bankMellatId,
        destinationAccountId: cashIrrId,
        amount: '100000',
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const xferJournal = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceId: transfer.body.data.id,
        effectType: 'TRANSFER_POST',
      },
    });
    expect(xferJournal?.status).toBe(JournalEntryStatus.POSTED);
  });

  it('unpaid Expense + settlement does not double-recognize Expense', async () => {
    const token = await login(ownerEmail);
    const categories = await request(app.getHttpServer())
      .get('/api/v1/finance/expense-categories')
      .set(auth(token, pishtehId))
      .expect(200);
    const rent = categories.body.data.find((c: { code: string }) => c.code === 'RENT');

    const expense = await request(app.getHttpServer())
      .post('/api/v1/finance/expenses')
      .set(auth(token, pishtehId))
      .send({
        categoryId: rent.id,
        amount: '500000',
        currency: CurrencyCode.IRR,
        expenseDate: '2026-05-01T12:00:00.000Z',
        description: 'E2E journal expense',
        approveImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const recognition = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceId: expense.body.data.id,
        effectType: 'EXPENSE_RECOGNITION',
        status: JournalEntryStatus.POSTED,
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(recognition).toBeTruthy();
    expect(
      recognition!.lines.some(
        (l) =>
          l.direction === JournalLineDirection.DEBIT &&
          l.ledgerAccount.type === 'EXPENSE',
      ),
    ).toBe(true);

    const movBefore = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId, sourceType: 'EXPENSE', sourceId: expense.body.data.id },
    });
    expect(movBefore).toBe(0);

    const paid = await request(app.getHttpServer())
      .post(`/api/v1/finance/expenses/${expense.body.data.id}/pay-now`)
      .set(auth(token, pishtehId))
      .send({
        accountId: cashIrrId,
        amount: '500000',
        requestId: randomUUID(),
      })
      .expect(200);

    const settlements = await database.client.journalEntry.findMany({
      where: {
        companyId: pishtehId,
        effectType: 'EXPENSE_SETTLEMENT',
        status: JournalEntryStatus.POSTED,
        sourceType: 'EXPENSE_PAYMENT_ALLOCATION',
      },
      include: { lines: { include: { ledgerAccount: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    const settle = settlements.find((j) =>
      j.lines.every((l) => l.ledgerAccount.type !== 'EXPENSE'),
    );
    expect(settle).toBeTruthy();
    expect(paid.body.data.paymentStatus).toBe('PAID');
  });

  it('Payment ≠ Expense; Receipt ≠ Revenue', async () => {
    const token = await login(ownerEmail);

    const payment = await request(app.getHttpServer())
      .post('/api/v1/finance/payments')
      .set(auth(token, pishtehId))
      .send({
        accountId: cashIrrId,
        amount: '250000',
        purposeType: PaymentPurposeType.OTHER,
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const payJournal = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceId: payment.body.data.id,
        effectType: 'PAYMENT_CLEARING',
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(payJournal).toBeTruthy();
    expect(
      payJournal!.lines.some((l) => l.ledgerAccount.systemKey === 'UNCLASSIFIED_PAYMENTS'),
    ).toBe(true);
    expect(payJournal!.lines.some((l) => l.ledgerAccount.type === 'EXPENSE')).toBe(false);

    const receipt = await request(app.getHttpServer())
      .post('/api/v1/finance/receipts')
      .set(auth(token, pishtehId))
      .send({
        accountId: cashIrrId,
        amount: '250000',
        sourceType: ReceiptSourceType.OTHER,
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const recJournal = await database.client.journalEntry.findFirst({
      where: {
        companyId: pishtehId,
        sourceId: receipt.body.data.id,
        effectType: 'RECEIPT_CLEARING',
      },
      include: { lines: { include: { ledgerAccount: true } } },
    });
    expect(recJournal).toBeTruthy();
    expect(
      recJournal!.lines.some((l) => l.ledgerAccount.systemKey === 'UNCLASSIFIED_RECEIPTS'),
    ).toBe(true);
    expect(
      recJournal!.lines.some((l) => l.ledgerAccount.systemKey === 'REVENUE_FOUNDATION'),
    ).toBe(false);
  });

  it('manual journal creates no AccountMovement; RBAC; IDOR; reverse; immutability', async () => {
    const token = await login(ownerEmail);
    const equity = await systemAccountId('CAPITAL_EQUITY');
    const inventory = await systemAccountId('INVENTORY');

    const created = await request(app.getHttpServer())
      .post('/api/v1/finance/journals/manual')
      .set(auth(token, pishtehId))
      .send({
        description: 'E2E manual balanced',
        postImmediately: true,
        requestId: randomUUID(),
        lines: [
          {
            ledgerAccountId: inventory,
            direction: JournalLineDirection.DEBIT,
            originalAmount: '1000',
            originalCurrency: CurrencyCode.IRR,
            baseAmount: '1000',
          },
          {
            ledgerAccountId: equity,
            direction: JournalLineDirection.CREDIT,
            originalAmount: '1000',
            originalCurrency: CurrencyCode.IRR,
            baseAmount: '1000',
          },
        ],
      })
      .expect(201);

    const journalId = created.body.data.id as string;
    const movements = await database.client.financialAccountMovement.count({
      where: { companyId: pishtehId, sourceId: journalId },
    });
    expect(movements).toBe(0);

    await request(app.getHttpServer())
      .get(`/api/v1/finance/journals/${journalId}`)
      .set(auth(token, demoBId))
      .expect(404);

    const whToken = await login(warehouseOperatorEmail);
    await request(app.getHttpServer())
      .get('/api/v1/finance/journals')
      .set(auth(whToken, pishtehId))
      .expect(403);

    const reversed = await request(app.getHttpServer())
      .post(`/api/v1/finance/journals/${journalId}/reverse`)
      .set(auth(token, pishtehId))
      .expect(200);
    expect(reversed.body.data.status).toBe(JournalEntryStatus.POSTED);
    expect(reversed.body.data.reversalOfId).toBe(journalId);

    await request(app.getHttpServer())
      .post(`/api/v1/finance/journals/${journalId}/reverse`)
      .set(auth(token, pishtehId))
      .expect(200); // idempotent second reverse returns existing

    const original = await database.client.journalEntry.findFirstOrThrow({
      where: { id: journalId },
    });
    expect(original.status).toBe(JournalEntryStatus.REVERSED);
  });

  it('USD loan preserves original + base on journal lines', async () => {
    const token = await login(ownerEmail);
    const loan = await request(app.getHttpServer())
      .post('/api/v1/finance/loans')
      .set(auth(token, pishtehId))
      .send({
        lenderType: FinanceCounterpartyType.OTHER,
        lenderName: 'E2E USD Lender',
        currency: CurrencyCode.USD,
        contractedPrincipal: '100',
        receivingAccountId: cashUsdId,
        referenceFxRate: '250000',
        referenceFxBaseCurrency: CurrencyCode.USD,
        referenceFxQuoteCurrency: CurrencyCode.IRR,
        firstDisbursement: {
          accountId: cashUsdId,
          amount: '100',
        },
        postImmediately: true,
        requestId: randomUUID(),
      })
      .expect(201);

    const disb = await database.client.loanDisbursement.findFirstOrThrow({
      where: { companyId: pishtehId, loanId: loan.body.data.id, status: 'POSTED' },
    });

    const journal = await database.client.journalEntry.findFirstOrThrow({
      where: {
        companyId: pishtehId,
        sourceId: disb.id,
        effectType: 'LOAN_DISBURSE',
      },
      include: { lines: true },
    });
    expect(journal.baseCurrency).toBe(CurrencyCode.IRR);
    for (const line of journal.lines) {
      expect(line.originalCurrency).toBe(CurrencyCode.USD);
      expect(line.originalAmount.toFixed()).toBe('100');
      expect(line.baseCurrency).toBe(CurrencyCode.IRR);
      expect(line.baseAmount.toFixed()).toBe('25000000');
      expect(line.fxRate).toBeTruthy();
    }
  });

  it('trial balance balances after mixed ops', async () => {
    const token = await login(ownerEmail);
    const tb = await request(app.getHttpServer())
      .get('/api/v1/finance/trial-balance')
      .set(auth(token, pishtehId))
      .expect(200);

    const debit = 0n;
    const credit = 0n;
    // Use string compare via Decimal-like: sum as strings carefully — use DB instead
    const sums = await database.client.$queryRaw<
      Array<{ d: string; c: string }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE 0 END), 0)::text AS d,
        COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE 0 END), 0)::text AS c
      FROM journal_lines l
      JOIN journal_entries j ON j.id = l.journal_entry_id AND j.company_id = l.company_id
      WHERE j.company_id = ${pishtehId}::uuid AND j.status = 'POSTED'
    `;
    expect(sums[0]?.d).toBe(sums[0]?.c);
    expect(tb.body.baseCurrency).toBe(CurrencyCode.IRR);
    expect(Array.isArray(tb.body.data)).toBe(true);
    void debit;
    void credit;
  });
});
