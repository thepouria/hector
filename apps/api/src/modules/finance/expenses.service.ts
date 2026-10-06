import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CurrencyCode,
  ExpenseCategoryStatus,
  ExpensePaymentAllocationStatus,
  ExpensePaymentStatus,
  ExpenseSourceType,
  ExpenseStatus,
  FinanceCounterpartyType,
  PaymentPurposeType,
  PaymentStatus,
  Prisma,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { getRequestContext } from '../../common/context/request-context';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import type { CompanyContext } from '../companies/types/company.types';
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import {
  EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH,
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  EXPENSE_ERROR_MESSAGES,
  EXPENSE_NOTES_MAX_LENGTH,
  EXPENSE_REFERENCE_MAX_LENGTH,
} from './finance-expenses.constants';
import {
  allocateExpenseSequence,
  formatExpenseNumber,
} from './expense-numbering';
import {
  assertExpenseOutstandingAllows,
  recomputeExpensePaymentStatusInTx,
  sumActiveExpenseAllocations,
} from './expense-payment-settlement';
import { parseMoneyAmount } from './money/money';
import { PaymentsService } from './payments.service';
import { JournalPostingService } from './journal-posting.service';
import { LedgerAccountsService } from './ledger-accounts.service';
import {
  postExpenseRecognitionJournalInTx,
  postExpenseSettlementJournalInTx,
} from './journal-builders';
import type {
  AllocateExpensePaymentDto,
  CreateExpenseDto,
  ListExpensesQueryDto,
  PayExpenseNowDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

const detailInclude = {
  category: { select: { id: true, code: true, name: true, status: true } },
  paymentAllocations: {
    where: { status: ExpensePaymentAllocationStatus.ACTIVE },
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      paymentId: true,
      amount: true,
      currency: true,
      status: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ExpenseInclude;

type DetailRow = Prisma.ExpenseGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

export type ExpenseView = {
  id: string;
  companyId: string;
  number: string;
  categoryId: string;
  category: { id: string; code: string; name: string; status: ExpenseCategoryStatus };
  amount: string;
  currency: CurrencyCode;
  expenseDate: Date;
  dueDate: Date | null;
  counterpartyType: FinanceCounterpartyType | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  description: string;
  reference: string | null;
  notes: string | null;
  status: ExpenseStatus;
  paymentStatus: ExpensePaymentStatus;
  paidAmount: string;
  outstandingAmount: string;
  sourceType: ExpenseSourceType;
  sourceId: string | null;
  requestId: string | null;
  createdById: string;
  approvedAt: Date | null;
  approvedById: string | null;
  cancelledAt: Date | null;
  cancelledById: string | null;
  createdAt: Date;
  updatedAt: Date;
  allocations: Array<{
    id: string;
    paymentId: string;
    amount: string;
    currency: CurrencyCode;
    status: ExpensePaymentAllocationStatus;
    createdAt: Date;
  }>;
};

@Injectable()
export class ExpensesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly paymentsService: PaymentsService,
    private readonly journalPosting: JournalPostingService,
    private readonly ledgerAccounts: LedgerAccountsService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListExpensesQueryDto,
  ): Promise<{ data: ExpenseView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const where: Prisma.ExpenseWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
              { counterpartyName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.expense.count({ where }),
      this.database.client.expense.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: detailInclude,
      }),
    ]);
    return {
      data: await Promise.all(rows.map((r) => this.toView(r))),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, id: string): Promise<ExpenseView> {
    return this.toView(await this.requireDetail(company.companyId, id));
  }

  async create(company: CompanyContext, dto: CreateExpenseDto): Promise<ExpenseView> {
    const actorUserId = this.requireActorUserId();
    const amount = this.parseAmount(dto.amount, dto.currency);
    const description = this.assertDescription(dto.description);
    const reference = assertOptionalText(
      dto.reference,
      EXPENSE_REFERENCE_MAX_LENGTH,
      EXPENSE_ERROR_MESSAGES.INVALID_REFERENCE,
    );
    const notes = assertOptionalText(
      dto.notes,
      EXPENSE_NOTES_MAX_LENGTH,
      EXPENSE_ERROR_MESSAGES.INVALID_NOTES,
    );
    const counterpartyName = assertOptionalText(
      dto.counterpartyName,
      EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH,
      EXPENSE_ERROR_MESSAGES.INVALID_COUNTERPARTY_NAME,
    );
    const expenseDate = new Date(dto.expenseDate);
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    const approveImmediately = dto.approveImmediately === true;

    return commitThenPublish(this.eventBus, async (events) => {
      if (dto.requestId) {
        const existing = await this.database.client.expense.findFirst({
          where: { companyId: company.companyId, requestId: dto.requestId },
          include: detailInclude,
        });
        if (existing) {
          this.assertIdempotentMatch(existing, dto, amount);
          return this.toView(existing);
        }
      }

      const row = await this.database.client.$transaction(async (tx) => {
        await this.requireActiveCategory(tx, company.companyId, dto.categoryId);
        const seq = await allocateExpenseSequence(tx, company.companyId);
        const number = formatExpenseNumber(seq);
        const now = new Date();
        const created = await tx.expense.create({
          data: {
            companyId: company.companyId,
            number,
            categoryId: dto.categoryId,
            amount,
            currency: dto.currency,
            expenseDate,
            dueDate,
            counterpartyType: dto.counterpartyType ?? null,
            counterpartyId: dto.counterpartyId ?? null,
            counterpartyName,
            description,
            reference,
            notes,
            requestId: dto.requestId ?? null,
            createdById: actorUserId,
            ...(approveImmediately
              ? {
                  status: ExpenseStatus.APPROVED,
                  approvedAt: now,
                  approvedById: actorUserId,
                }
              : {}),
          },
          include: detailInclude,
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.EXPENSE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.EXPENSE,
          entityId: created.id,
          after: {
            number: created.number,
            amount: created.amount.toString(),
            currency: created.currency,
            status: created.status,
          },
        });
        if (approveImmediately) {
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.EXPENSE_APPROVED,
            entityType: AUDIT_ENTITY_TYPES.EXPENSE,
            entityId: created.id,
            after: { status: ExpenseStatus.APPROVED },
          });
          await postExpenseRecognitionJournalInTx(
            tx,
            { journals: this.journalPosting, ledger: this.ledgerAccounts },
            {
              companyId: company.companyId,
              actorUserId,
              expenseId: created.id,
              categoryId: created.categoryId,
              amount: created.amount,
              currency: created.currency,
              effectiveAt: created.expenseDate,
              number: created.number,
            },
          );
        }
        return created;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.EXPENSE_CREATED,
          payload: {
            companyId: company.companyId,
            expenseId: row.id,
            number: row.number,
          },
        }),
      );
      if (approveImmediately) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.EXPENSE_APPROVED,
            payload: {
              companyId: company.companyId,
              expenseId: row.id,
              number: row.number,
            },
          }),
        );
      }
      return this.toView(row);
    });
  }

  /**
   * Internal TX helper for PERIOD_EXPENSE recognition from PurchaseOrderCost.
   * Creates APPROVED expense with sourceType=PURCHASE_ORDER_COST (FIN-EXP-012).
   */
  async createFromPurchaseOrderCostInTx(
    tx: Tx,
    args: {
      companyId: string;
      actorUserId: string;
      categoryId: string;
      amount: Prisma.Decimal;
      currency: CurrencyCode;
      expenseDate: Date;
      description: string;
      counterpartyName?: string | null;
      reference?: string | null;
      purchaseOrderCostId: string;
      requestId?: string | null;
    },
  ): Promise<{ id: string; number: string }> {
    const existing = await tx.expense.findFirst({
      where: {
        companyId: args.companyId,
        sourceType: ExpenseSourceType.PURCHASE_ORDER_COST,
        sourceId: args.purchaseOrderCostId,
      },
      select: {
        id: true,
        number: true,
        categoryId: true,
        amount: true,
        currency: true,
        expenseDate: true,
      },
    });
    if (existing) {
      // Idempotent ensure: recognition journal may be missing on pre-fix rows.
      await postExpenseRecognitionJournalInTx(
        tx,
        { journals: this.journalPosting, ledger: this.ledgerAccounts },
        {
          companyId: args.companyId,
          actorUserId: args.actorUserId,
          expenseId: existing.id,
          categoryId: existing.categoryId,
          amount: existing.amount,
          currency: existing.currency,
          effectiveAt: existing.expenseDate,
          number: existing.number,
        },
      );
      return { id: existing.id, number: existing.number };
    }

    await this.requireActiveCategory(tx, args.companyId, args.categoryId);
    const seq = await allocateExpenseSequence(tx, args.companyId);
    const number = formatExpenseNumber(seq);
    const now = new Date();
    const created = await tx.expense.create({
      data: {
        companyId: args.companyId,
        number,
        categoryId: args.categoryId,
        amount: args.amount,
        currency: args.currency,
        expenseDate: args.expenseDate,
        description: args.description,
        counterpartyName: args.counterpartyName ?? null,
        reference: args.reference ?? null,
        sourceType: ExpenseSourceType.PURCHASE_ORDER_COST,
        sourceId: args.purchaseOrderCostId,
        requestId: args.requestId ?? null,
        status: ExpenseStatus.APPROVED,
        approvedAt: now,
        approvedById: args.actorUserId,
        createdById: args.actorUserId,
      },
      select: { id: true, number: true },
    });
    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.EXPENSE_CREATED,
      entityType: AUDIT_ENTITY_TYPES.EXPENSE,
      entityId: created.id,
      after: {
        number: created.number,
        sourceType: ExpenseSourceType.PURCHASE_ORDER_COST,
        sourceId: args.purchaseOrderCostId,
      },
    });
    // FIN-JRN-019: APPROVED PERIOD_EXPENSE must post recognition exactly once.
    await postExpenseRecognitionJournalInTx(
      tx,
      { journals: this.journalPosting, ledger: this.ledgerAccounts },
      {
        companyId: args.companyId,
        actorUserId: args.actorUserId,
        expenseId: created.id,
        categoryId: args.categoryId,
        amount: args.amount,
        currency: args.currency,
        effectiveAt: args.expenseDate,
        number: created.number,
      },
    );
    return created;
  }

  async update(
    company: CompanyContext,
    id: string,
    dto: UpdateExpenseDto,
  ): Promise<ExpenseView> {
    const actorUserId = this.requireActorUserId();
    void actorUserId;
    return commitThenPublish(this.eventBus, async () => {
      const row = await this.database.client.$transaction(async (tx) => {
        const existing = await this.lockExpense(tx, company.companyId, id);
        if (existing.status !== ExpenseStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.EXPENSE_NOT_EDITABLE,
            message: EXPENSE_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }
        const currency = dto.currency ?? existing.currency;
        const amount =
          dto.amount !== undefined
            ? this.parseAmount(dto.amount, currency)
            : existing.amount;
        if (dto.categoryId) {
          await this.requireActiveCategory(tx, company.companyId, dto.categoryId);
        }
        const updated = await tx.expense.update({
          where: { id },
          data: {
            ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
            amount,
            currency,
            ...(dto.expenseDate ? { expenseDate: new Date(dto.expenseDate) } : {}),
            ...(dto.dueDate !== undefined
              ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
              : {}),
            ...(dto.counterpartyType !== undefined
              ? { counterpartyType: dto.counterpartyType }
              : {}),
            ...(dto.counterpartyId !== undefined
              ? { counterpartyId: dto.counterpartyId }
              : {}),
            ...(dto.counterpartyName !== undefined
              ? {
                  counterpartyName: assertOptionalText(
                    dto.counterpartyName ?? undefined,
                    EXPENSE_COUNTERPARTY_NAME_MAX_LENGTH,
                    EXPENSE_ERROR_MESSAGES.INVALID_COUNTERPARTY_NAME,
                  ),
                }
              : {}),
            ...(dto.description !== undefined
              ? { description: this.assertDescription(dto.description) }
              : {}),
            ...(dto.reference !== undefined
              ? {
                  reference: assertOptionalText(
                    dto.reference ?? undefined,
                    EXPENSE_REFERENCE_MAX_LENGTH,
                    EXPENSE_ERROR_MESSAGES.INVALID_REFERENCE,
                  ),
                }
              : {}),
            ...(dto.notes !== undefined
              ? {
                  notes: assertOptionalText(
                    dto.notes ?? undefined,
                    EXPENSE_NOTES_MAX_LENGTH,
                    EXPENSE_ERROR_MESSAGES.INVALID_NOTES,
                  ),
                }
              : {}),
          },
          include: detailInclude,
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.EXPENSE_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.EXPENSE,
          entityId: updated.id,
          before: { amount: existing.amount.toString() },
          after: { amount: updated.amount.toString() },
        });
        return updated;
      });
      return this.toView(row);
    });
  }

  async approve(company: CompanyContext, id: string): Promise<ExpenseView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockExpense(tx, company.companyId, id);
        if (locked.status === ExpenseStatus.APPROVED) {
          return this.loadDetailInTx(tx, company.companyId, id);
        }
        if (locked.status !== ExpenseStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.EXPENSE_NOT_APPROVABLE,
            message: EXPENSE_ERROR_MESSAGES.NOT_APPROVABLE,
            statusCode: 409,
          });
        }
        const now = new Date();
        const updated = await tx.expense.update({
          where: { id },
          data: {
            status: ExpenseStatus.APPROVED,
            approvedAt: now,
            approvedById: actorUserId,
          },
          include: detailInclude,
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.EXPENSE_APPROVED,
          entityType: AUDIT_ENTITY_TYPES.EXPENSE,
          entityId: updated.id,
          before: { status: ExpenseStatus.DRAFT },
          after: { status: ExpenseStatus.APPROVED },
        });
        await postExpenseRecognitionJournalInTx(
          tx,
          { journals: this.journalPosting, ledger: this.ledgerAccounts },
          {
            companyId: company.companyId,
            actorUserId,
            expenseId: updated.id,
            categoryId: updated.categoryId,
            amount: updated.amount,
            currency: updated.currency,
            effectiveAt: updated.expenseDate,
            number: updated.number,
          },
        );
        return updated;
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.EXPENSE_APPROVED,
          payload: {
            companyId: company.companyId,
            expenseId: row.id,
            number: row.number,
          },
        }),
      );
      return this.toView(row);
    });
  }

  async cancel(company: CompanyContext, id: string): Promise<ExpenseView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockExpense(tx, company.companyId, id);
        if (locked.status === ExpenseStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, id);
        }
        if (
          locked.status !== ExpenseStatus.DRAFT &&
          locked.status !== ExpenseStatus.APPROVED
        ) {
          throw new AppError({
            code: ERROR_CODES.EXPENSE_NOT_CANCELLABLE,
            message: EXPENSE_ERROR_MESSAGES.NOT_CANCELLABLE,
            statusCode: 409,
          });
        }
        const paid = await sumActiveExpenseAllocations(tx, company.companyId, id);
        if (paid.gt(0)) {
          throw new AppError({
            code: ERROR_CODES.EXPENSE_CANCEL_WITH_PAYMENTS,
            message: EXPENSE_ERROR_MESSAGES.CANCEL_WITH_PAYMENTS,
            statusCode: 409,
          });
        }
        const updated = await tx.expense.update({
          where: { id },
          data: {
            status: ExpenseStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorUserId,
          },
          include: detailInclude,
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.EXPENSE_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.EXPENSE,
          entityId: updated.id,
          before: { status: locked.status },
          after: { status: ExpenseStatus.CANCELLED },
        });
        return updated;
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.EXPENSE_CANCELLED,
          payload: {
            companyId: company.companyId,
            expenseId: row.id,
            number: row.number,
          },
        }),
      );
      return this.toView(row);
    });
  }

  async allocatePayment(
    company: CompanyContext,
    expenseId: string,
    dto: AllocateExpensePaymentDto,
  ): Promise<ExpenseView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      if (dto.requestId) {
        const existingAlloc = await this.database.client.expensePaymentAllocation.findFirst({
          where: { companyId: company.companyId, requestId: dto.requestId },
        });
        if (existingAlloc) {
          return this.toView(
            await this.requireDetail(company.companyId, existingAlloc.expenseId),
          );
        }
      }

      const result = await this.database.client.$transaction(async (tx) => {
        const payment = await tx.payment.findFirst({
          where: { id: dto.paymentId, companyId: company.companyId },
        });
        if (!payment) {
          throw new AppError({
            code: ERROR_CODES.PAYMENT_NOT_FOUND,
            message: 'Payment not found.',
            statusCode: 404,
          });
        }
        if (payment.status !== PaymentStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.EXPENSE_PAYMENT_NOT_POSTED,
            message: EXPENSE_ERROR_MESSAGES.PAYMENT_NOT_POSTED,
            statusCode: 409,
          });
        }
        const amount = this.parseAmount(dto.amount, payment.currency);
        await assertExpenseOutstandingAllows(
          tx,
          company.companyId,
          expenseId,
          amount,
          payment.currency,
        );

        const alloc = await tx.expensePaymentAllocation.create({
          data: {
            companyId: company.companyId,
            expenseId,
            paymentId: payment.id,
            amount,
            currency: payment.currency,
            createdById: actorUserId,
            requestId: dto.requestId ?? null,
          },
        });
        const settlement = await recomputeExpensePaymentStatusInTx(
          tx,
          company.companyId,
          expenseId,
        );
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.EXPENSE_PAYMENT_ALLOCATED,
          entityType: AUDIT_ENTITY_TYPES.EXPENSE_PAYMENT_ALLOCATION,
          entityId: alloc.id,
          after: {
            expenseId,
            paymentId: payment.id,
            amount: amount.toString(),
            paymentStatus: settlement.paymentStatus,
          },
        });
        const expense = await this.loadDetailInTx(tx, company.companyId, expenseId);
        await postExpenseSettlementJournalInTx(
          tx,
          { journals: this.journalPosting, ledger: this.ledgerAccounts },
          {
            companyId: company.companyId,
            actorUserId,
            allocationId: alloc.id,
            amount,
            currency: payment.currency,
            effectiveAt: payment.effectiveAt,
            expenseNumber: expense.number,
          },
        );
        return {
          expense,
          settlement,
        };
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.EXPENSE_PAYMENT_ALLOCATED,
          payload: {
            companyId: company.companyId,
            expenseId,
            paymentId: dto.paymentId,
            amount: dto.amount,
          },
        }),
      );
      if (result.settlement.paymentStatus === ExpensePaymentStatus.PAID) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.EXPENSE_PAID,
            payload: {
              companyId: company.companyId,
              expenseId,
              number: result.expense.number,
            },
          }),
        );
      }
      return this.toView(result.expense);
    });
  }

  /**
   * Direct Pay Now: approve if needed + create/post Payment + allocate (atomic docs).
   * Cross-currency rejected (Phase 4.9).
   */
  async payNow(
    company: CompanyContext,
    expenseId: string,
    dto: PayExpenseNowDto,
  ): Promise<ExpenseView> {
    const actorUserId = this.requireActorUserId();
    void actorUserId;

    // Ensure expense is approved first (may already be).
    let expense = await this.requireDetail(company.companyId, expenseId);
    if (expense.status === ExpenseStatus.DRAFT) {
      expense = await this.requireDetail(
        company.companyId,
        (await this.approve(company, expenseId)).id,
      );
    }
    if (expense.status !== ExpenseStatus.APPROVED) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_NOT_ALLOCATABLE,
        message: EXPENSE_ERROR_MESSAGES.NOT_ALLOCATABLE,
        statusCode: 409,
      });
    }

    const paid = await sumActiveExpenseAllocations(
      this.database.client,
      company.companyId,
      expenseId,
    );
    const outstanding = new Prisma.Decimal(expense.amount).sub(paid);
    if (outstanding.lte(0)) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_OVER_ALLOCATION,
        message: EXPENSE_ERROR_MESSAGES.OVER_ALLOCATION,
        statusCode: 409,
      });
    }
    const payAmount = dto.amount
      ? this.parseAmount(dto.amount, expense.currency)
      : outstanding;
    if (payAmount.gt(outstanding)) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_OVER_ALLOCATION,
        message: EXPENSE_ERROR_MESSAGES.OVER_ALLOCATION,
        statusCode: 409,
      });
    }

    const paymentRequestId = dto.requestId ?? randomUUID();
    const payment = await this.paymentsService.create(company, {
      accountId: dto.accountId,
      amount: payAmount.toString(),
      purposeType: PaymentPurposeType.EXPENSE,
      purposeReferenceType: 'EXPENSE',
      purposeReferenceId: expenseId,
      counterpartyType: expense.counterpartyType ?? undefined,
      counterpartyId: expense.counterpartyId ?? undefined,
      counterpartyName: expense.counterpartyName ?? undefined,
      effectiveAt: dto.effectiveAt,
      notes: dto.notes,
      postImmediately: true,
      requestId: paymentRequestId,
    });

    if (payment.currency !== expense.currency) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CROSS_CURRENCY,
        message: EXPENSE_ERROR_MESSAGES.CROSS_CURRENCY,
        statusCode: 409,
      });
    }

    return this.allocatePayment(company, expenseId, {
      paymentId: payment.id,
      amount: payAmount.toString(),
      requestId: randomUUID(),
    });
  }

  private async requireActiveCategory(
    tx: Tx,
    companyId: string,
    categoryId: string,
  ): Promise<void> {
    const cat = await tx.expenseCategory.findFirst({
      where: { id: categoryId, companyId },
    });
    if (!cat) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CATEGORY_NOT_FOUND,
        message: EXPENSE_ERROR_MESSAGES.CATEGORY_NOT_FOUND,
        statusCode: 404,
      });
    }
    if (cat.status !== ExpenseCategoryStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CATEGORY_INACTIVE,
        message: EXPENSE_ERROR_MESSAGES.CATEGORY_INACTIVE,
        statusCode: 409,
      });
    }
  }

  private async lockExpense(tx: Tx, companyId: string, id: string) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: ExpenseStatus;
        amount: Prisma.Decimal;
        currency: CurrencyCode;
        payment_status: ExpensePaymentStatus;
      }>
    >(Prisma.sql`
      SELECT id, status, amount, currency, payment_status
      FROM expenses
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_NOT_FOUND,
        message: EXPENSE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return {
      id: row.id,
      status: row.status,
      amount: row.amount,
      currency: row.currency,
      paymentStatus: row.payment_status,
    };
  }

  private async requireDetail(companyId: string, id: string): Promise<DetailRow> {
    const row = await this.database.client.expense.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_NOT_FOUND,
        message: EXPENSE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(
    tx: Tx,
    companyId: string,
    id: string,
  ): Promise<DetailRow> {
    const row = await tx.expense.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_NOT_FOUND,
        message: EXPENSE_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async toView(row: DetailRow): Promise<ExpenseView> {
    const paid = row.paymentAllocations.reduce(
      (acc, a) => acc.add(a.amount),
      new Prisma.Decimal(0),
    );
    const outstanding = row.amount.sub(paid);
    return {
      id: row.id,
      companyId: row.companyId,
      number: row.number,
      categoryId: row.categoryId,
      category: row.category,
      amount: row.amount.toString(),
      currency: row.currency,
      expenseDate: row.expenseDate,
      dueDate: row.dueDate,
      counterpartyType: row.counterpartyType,
      counterpartyId: row.counterpartyId,
      counterpartyName: row.counterpartyName,
      description: row.description,
      reference: row.reference,
      notes: row.notes,
      status: row.status,
      paymentStatus: row.paymentStatus,
      paidAmount: paid.toString(),
      outstandingAmount: outstanding.toString(),
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      requestId: row.requestId,
      createdById: row.createdById,
      approvedAt: row.approvedAt,
      approvedById: row.approvedById,
      cancelledAt: row.cancelledAt,
      cancelledById: row.cancelledById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      allocations: row.paymentAllocations.map((a) => ({
        id: a.id,
        paymentId: a.paymentId,
        amount: a.amount.toString(),
        currency: a.currency,
        status: a.status,
        createdAt: a.createdAt,
      })),
    };
  }

  private parseAmount(value: string, currency: CurrencyCode): Prisma.Decimal {
    try {
      return parseMoneyAmount(value, currency);
    } catch {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_INVALID_MONEY,
        message: EXPENSE_ERROR_MESSAGES.INVALID_MONEY,
        statusCode: 400,
      });
    }
  }

  private assertDescription(raw: string): string {
    const description = raw.trim();
    if (
      !description ||
      description.length > EXPENSE_DESCRIPTION_MAX_LENGTH
    ) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_NOT_EDITABLE,
        message: EXPENSE_ERROR_MESSAGES.INVALID_DESCRIPTION,
        statusCode: 400,
      });
    }
    return description;
  }

  private assertIdempotentMatch(
    existing: DetailRow,
    dto: CreateExpenseDto,
    amount: Prisma.Decimal,
  ): void {
    if (
      existing.categoryId !== dto.categoryId ||
      !existing.amount.eq(amount) ||
      existing.currency !== dto.currency ||
      existing.description !== dto.description.trim()
    ) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_IDEMPOTENCY_CONFLICT,
        message: EXPENSE_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private requireActorUserId(): string {
    const ctx = getRequestContext();
    if (!ctx?.userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required.',
        statusCode: 401,
      });
    }
    return ctx.userId;
  }
}
