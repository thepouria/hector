import {
  Prisma,
  runFinanceIntegrityChecks,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp } from './helpers/e2e-app';

/**
 * Phase 4.12 — controlled corruption must FAIL read-only finance integrity.
 * Never auto-repairs; each case restores the fixture before exit.
 */
describe('Finance integrity corruption detection (Phase 4.12)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let pishtehId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);
    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  function expectCheck(
    summary: Awaited<ReturnType<typeof runFinanceIntegrityChecks>>,
    check: string,
  ) {
    expect(summary.status).toBe('FAILED');
    expect(summary.violations.length).toBeGreaterThan(0);
    expect(summary.violations.some((v) => v.check === check)).toBe(true);
  }

  it('detects unbalanced posted journal (does not repair)', async () => {
    const journal = await database.client.journalEntry.findFirst({
      where: { companyId: pishtehId, status: 'POSTED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(journal).toBeTruthy();
    if (!journal) return;

    const beforeDebit = journal.totalDebitBase;
    const corrupted = beforeDebit.add(1);

    await database.client.journalEntry.update({
      where: { id: journal.id },
      data: { totalDebitBase: corrupted },
    });

    try {
      const still = await database.client.journalEntry.findUniqueOrThrow({
        where: { id: journal.id },
      });
      expect(still.totalDebitBase.equals(corrupted)).toBe(true);

      const summary = await runFinanceIntegrityChecks(database.client);
      expectCheck(summary, 'journal_posted_unbalanced');
      expect(
        summary.violations.some(
          (v) =>
            v.check === 'journal_header_totals_vs_lines' ||
            v.check === 'journal_totals_mismatch_lines',
        ),
      ).toBe(true);

      const afterCheck = await database.client.journalEntry.findUniqueOrThrow({
        where: { id: journal.id },
      });
      expect(afterCheck.totalDebitBase.equals(corrupted)).toBe(true);
    } finally {
      await database.client.journalEntry.update({
        where: { id: journal.id },
        data: { totalDebitBase: beforeDebit },
      });
    }
  });

  it('detects orphan payment movement source (does not repair)', async () => {
    const movement = await database.client.financialAccountMovement.findFirst({
      where: { companyId: pishtehId, sourceType: 'PAYMENT', sourceId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    expect(movement).toBeTruthy();
    if (!movement || !movement.sourceId) return;

    const originalSourceId = movement.sourceId;
    const fakeId = randomUUID();

    await database.client.financialAccountMovement.update({
      where: { id: movement.id },
      data: { sourceId: fakeId },
    });

    try {
      const still = await database.client.financialAccountMovement.findUniqueOrThrow({
        where: { id: movement.id },
      });
      expect(still.sourceId).toBe(fakeId);

      const summary = await runFinanceIntegrityChecks(database.client);
      expectCheck(summary, 'orphan_payment_movement_source');

      const afterCheck = await database.client.financialAccountMovement.findUniqueOrThrow({
        where: { id: movement.id },
      });
      expect(afterCheck.sourceId).toBe(fakeId);
    } finally {
      await database.client.financialAccountMovement.update({
        where: { id: movement.id },
        data: { sourceId: originalSourceId },
      });
    }
  });

  it('detects non-positive movement amount (does not repair)', async () => {
    const movement = await database.client.financialAccountMovement.findFirst({
      where: { companyId: pishtehId, amount: { gt: 0 } },
      orderBy: { createdAt: 'desc' },
    });
    expect(movement).toBeTruthy();
    if (!movement) return;

    const beforeAmount = movement.amount;

    // CHECK normally blocks amount <= 0; drop briefly so we can prove the read-only checker.
    await database.client.$executeRawUnsafe(
      `ALTER TABLE financial_account_movements DROP CONSTRAINT IF EXISTS financial_account_movements_amount_positive_check`,
    );

    try {
      await database.client.financialAccountMovement.update({
        where: { id: movement.id },
        data: { amount: new Prisma.Decimal(0) },
      });

      const still = await database.client.financialAccountMovement.findUniqueOrThrow({
        where: { id: movement.id },
      });
      expect(still.amount.equals(0)).toBe(true);

      const summary = await runFinanceIntegrityChecks(database.client);
      expectCheck(summary, 'movement_non_positive_amount');

      const afterCheck = await database.client.financialAccountMovement.findUniqueOrThrow({
        where: { id: movement.id },
      });
      expect(afterCheck.amount.equals(0)).toBe(true);
    } finally {
      await database.client.financialAccountMovement.update({
        where: { id: movement.id },
        data: { amount: beforeAmount },
      });
      await database.client.$executeRawUnsafe(
        `ALTER TABLE financial_account_movements ADD CONSTRAINT financial_account_movements_amount_positive_check CHECK (amount > 0)`,
      );
    }
  });

  it('detects payable negative outstanding via extra decrease (does not repair)', async () => {
    const payable = await database.client.supplierPayable.findFirst({
      where: { companyId: pishtehId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(payable).toBeTruthy();
    if (!payable) return;

    const owner = await database.client.user.findUniqueOrThrow({
      where: { email: 'pouria@hector.local' },
    });

    const corrupt = await database.client.supplierLiabilityMovement.create({
      data: {
        companyId: pishtehId,
        payableId: payable.id,
        supplierId: payable.supplierId,
        direction: 'DECREASE',
        type: 'PAYMENT_ALLOCATION',
        amount: new Prisma.Decimal('999999999999'),
        currency: payable.currency,
        effectiveAt: new Date(),
        sourceType: 'FINANCE_INTEGRITY_CORRUPTION_TEST',
        sourceId: randomUUID(),
        notes: 'Phase 4.12 corruption fixture — restore deletes this row',
        createdById: owner.id,
      },
    });

    try {
      const still = await database.client.supplierLiabilityMovement.findUniqueOrThrow({
        where: { id: corrupt.id },
      });
      expect(still.amount.toFixed()).toBe('999999999999');

      const summary = await runFinanceIntegrityChecks(database.client);
      expectCheck(summary, 'payable_negative_outstanding');

      const afterCheck = await database.client.supplierLiabilityMovement.findUniqueOrThrow({
        where: { id: corrupt.id },
      });
      expect(afterCheck.id).toBe(corrupt.id);
    } finally {
      await database.client.supplierLiabilityMovement.delete({ where: { id: corrupt.id } });
    }
  });
});
