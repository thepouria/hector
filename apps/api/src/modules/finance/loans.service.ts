import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
  LoanDisbursementStatus,
  LoanRepaymentStatus,
  LoanStatus,
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
import { postMovementsInTx } from './account-movements.writer';
import {
  allocateLoanDisbursementSequence,
  allocateLoanRepaymentSequence,
  allocateLoanSequence,
  formatLoanDisbursementNumber,
  formatLoanNumber,
  formatLoanRepaymentNumber,
} from './capital-loan-numbering';
import { FINANCE_ACCOUNT_SOURCE_TYPES } from './finance-accounts.constants';
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import {
  LOAN_ERROR_MESSAGES,
  LOAN_LENDER_NAME_MAX_LENGTH,
  LOAN_NOTES_MAX_LENGTH,
  LOAN_REFERENCE_MAX_LENGTH,
} from './finance-capital-loans.constants';
import {
  deriveLoanOperationalStatus,
  deriveLoanPrincipalTotals,
  isLoanOverdue,
} from './loan-outstanding';
import { parseMoneyAmount } from './money/money';
import type {
  CreateLoanDisbursementDto,
  CreateLoanDto,
  CreateLoanRepaymentDto,
  ListLoansQueryDto,
  UpdateLoanDto,
} from './dto/loan.dto';
import type {
  LoanDisbursementView,
  LoanRepaymentView,
  LoanView,
} from './types/finance-capital-loan.types';

const accountSelect = {
  id: true,
  code: true,
  name: true,
  currency: true,
  status: true,
} as const;

const loanInclude = {
  receivingAccount: { select: accountSelect },
  disbursements: {
    include: { account: { select: accountSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
  repayments: {
    include: { account: { select: accountSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.LoanInclude;

type LoanDetail = Prisma.LoanGetPayload<{ include: typeof loanInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class LoansService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListLoansQueryDto,
  ): Promise<{ data: LoanView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const where: Prisma.LoanWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { lenderName: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.loan.count({ where }),
      this.database.client.loan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: loanInclude,
      }),
    ]);

    let views = rows.map((row) => this.toLoanView(row));
    if (query.overdueOnly) {
      views = views.filter((v) => v.overdue);
    }

    return {
      data: views,
      meta: buildPaginationMeta(query.page, query.pageSize, query.overdueOnly ? views.length : total),
    };
  }

  async get(company: CompanyContext, loanId: string): Promise<LoanView> {
    return this.toLoanView(await this.requireLoanDetail(company.companyId, loanId));
  }

  async create(company: CompanyContext, dto: CreateLoanDto): Promise<LoanView> {
    const actorUserId = this.requireActorUserId();
    const lenderName = this.assertLenderName(dto.lenderName);
    const notes = assertOptionalText(dto.notes, LOAN_NOTES_MAX_LENGTH, LOAN_ERROR_MESSAGES.INVALID_NOTES);
    const reference = assertOptionalText(
      dto.reference,
      LOAN_REFERENCE_MAX_LENGTH,
      LOAN_ERROR_MESSAGES.INVALID_REFERENCE,
    );
    const interestNotes = assertOptionalText(
      dto.interestNotes,
      LOAN_NOTES_MAX_LENGTH,
      LOAN_ERROR_MESSAGES.INVALID_NOTES,
    );

    let contractedPrincipal: Prisma.Decimal;
    try {
      contractedPrincipal = parseMoneyAmount(dto.contractedPrincipal, dto.currency);
    } catch {
      throw AppError.validation(LOAN_ERROR_MESSAGES.INVALID_MONEY);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const existing = await this.database.client.loan.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
        include: loanInclude,
      });
      if (existing) {
        this.assertLoanIdempotent(existing, dto, contractedPrincipal);
        return this.toLoanView(existing);
      }

      try {
        const result = await this.database.client.$transaction(async (tx) => {
          if (dto.receivingAccountId) {
            await this.requireActiveAccount(tx, company.companyId, dto.receivingAccountId, dto.currency);
          }

          const seq = await allocateLoanSequence(tx, company.companyId);
          const number = formatLoanNumber(seq);

          let loan = await tx.loan.create({
            data: {
              companyId: company.companyId,
              number,
              lenderType: dto.lenderType,
              lenderId: dto.lenderId ?? null,
              lenderName,
              currency: dto.currency,
              contractedPrincipal,
              referenceFxRate: dto.referenceFxRate ? new Prisma.Decimal(dto.referenceFxRate) : null,
              referenceFxBaseCurrency: dto.referenceFxBaseCurrency ?? null,
              referenceFxQuoteCurrency: dto.referenceFxQuoteCurrency ?? null,
              dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
              interestRate: dto.interestRate ? new Prisma.Decimal(dto.interestRate) : null,
              interestNotes,
              feeAmount: dto.feeAmount
                ? parseMoneyAmount(dto.feeAmount, dto.currency, { allowZero: true })
                : null,
              notes,
              reference,
              status: LoanStatus.DRAFT,
              receivingAccountId: dto.receivingAccountId ?? null,
              requestId: dto.requestId,
              createdById: actorUserId,
            },
            include: loanInclude,
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.LOAN_CREATED,
            entityType: AUDIT_ENTITY_TYPES.LOAN,
            entityId: loan.id,
            before: null,
            after: {
              number: loan.number,
              currency: loan.currency,
              contractedPrincipal: contractedPrincipal.toFixed(),
              status: loan.status,
            },
          });

          let disbursed = false;
          if (dto.firstDisbursement) {
            const disb = await this.createDisbursementInTx(
              tx,
              company.companyId,
              loan.id,
              {
                accountId: dto.firstDisbursement.accountId,
                amount: dto.firstDisbursement.amount,
                effectiveAt: dto.firstDisbursement.effectiveAt,
                notes: dto.firstDisbursement.notes,
                postImmediately: dto.postImmediately === true,
                requestId: dto.firstDisbursement.requestId ?? dto.requestId,
              },
              actorUserId,
              dto.firstDisbursement.requestId ? false : true,
            );
            loan = await this.loadLoanDetailInTx(tx, company.companyId, loan.id);
            disbursed = disb.status === LoanDisbursementStatus.POSTED;
          }

          return { loan, disbursed };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.LOAN_CREATED,
            payload: {
              companyId: company.companyId,
              loanId: result.loan.id,
              number: result.loan.number,
              currency: result.loan.currency,
              status: result.loan.status,
            },
          }),
        );

        if (result.disbursed) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.LOAN_DISBURSED,
              payload: {
                companyId: company.companyId,
                loanId: result.loan.id,
                number: result.loan.number,
                currency: result.loan.currency,
                outstandingPrincipal: this.toLoanView(result.loan).outstandingPrincipal,
              },
            }),
          );
          if (result.loan.status === LoanStatus.SETTLED) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.LOAN_SETTLED,
                payload: { companyId: company.companyId, loanId: result.loan.id },
              }),
            );
          }
        }

        return this.toLoanView(result.loan);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const again = await this.database.client.loan.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: loanInclude,
          });
          if (again) {
            this.assertLoanIdempotent(again, dto, contractedPrincipal);
            return this.toLoanView(again);
          }
          throw new AppError({
            code: ERROR_CODES.LOAN_IDEMPOTENCY_CONFLICT,
            message: LOAN_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
            statusCode: 409,
          });
        }
        throw error;
      }
    });
  }

  async update(company: CompanyContext, loanId: string, dto: UpdateLoanDto): Promise<LoanView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockLoan(tx, company.companyId, loanId);
        const notesAlwaysOk =
          dto.notes !== undefined ||
          dto.interestNotes !== undefined ||
          dto.reference !== undefined;

        const economicKeys = [
          'lenderType',
          'lenderId',
          'lenderName',
          'contractedPrincipal',
          'receivingAccountId',
          'referenceFxRate',
          'referenceFxBaseCurrency',
          'referenceFxQuoteCurrency',
          'dueDate',
          'interestRate',
          'feeAmount',
        ] as const;
        const hasEconomic = economicKeys.some((k) => dto[k] !== undefined);

        if (hasEconomic && locked.status !== LoanStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.LOAN_NOT_EDITABLE,
            message: LOAN_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }

        if (!hasEconomic && !notesAlwaysOk) {
          return this.loadLoanDetailInTx(tx, company.companyId, loanId);
        }

        let contractedPrincipal = locked.contractedPrincipal;
        if (dto.contractedPrincipal !== undefined) {
          try {
            contractedPrincipal = parseMoneyAmount(dto.contractedPrincipal, locked.currency);
          } catch {
            throw AppError.validation(LOAN_ERROR_MESSAGES.INVALID_MONEY);
          }
        }

        if (dto.receivingAccountId) {
          await this.requireActiveAccount(
            tx,
            company.companyId,
            dto.receivingAccountId,
            locked.currency,
          );
        }

        const row = await tx.loan.update({
          where: { id: locked.id },
          data: {
            ...(locked.status === LoanStatus.DRAFT
              ? {
                  lenderType: dto.lenderType ?? locked.lenderType,
                  lenderId: dto.lenderId !== undefined ? dto.lenderId : locked.lenderId,
                  lenderName:
                    dto.lenderName !== undefined
                      ? this.assertLenderName(dto.lenderName)
                      : locked.lenderName,
                  contractedPrincipal,
                  receivingAccountId:
                    dto.receivingAccountId !== undefined
                      ? dto.receivingAccountId
                      : locked.receivingAccountId,
                  referenceFxRate:
                    dto.referenceFxRate !== undefined
                      ? dto.referenceFxRate
                        ? new Prisma.Decimal(dto.referenceFxRate)
                        : null
                      : locked.referenceFxRate,
                  referenceFxBaseCurrency:
                    dto.referenceFxBaseCurrency !== undefined
                      ? dto.referenceFxBaseCurrency
                      : locked.referenceFxBaseCurrency,
                  referenceFxQuoteCurrency:
                    dto.referenceFxQuoteCurrency !== undefined
                      ? dto.referenceFxQuoteCurrency
                      : locked.referenceFxQuoteCurrency,
                  dueDate:
                    dto.dueDate !== undefined
                      ? dto.dueDate
                        ? new Date(dto.dueDate)
                        : null
                      : locked.dueDate,
                  interestRate:
                    dto.interestRate !== undefined
                      ? dto.interestRate
                        ? new Prisma.Decimal(dto.interestRate)
                        : null
                      : locked.interestRate,
                  feeAmount:
                    dto.feeAmount !== undefined
                      ? dto.feeAmount
                        ? parseMoneyAmount(dto.feeAmount, locked.currency, { allowZero: true })
                        : null
                      : locked.feeAmount,
                }
              : {}),
            interestNotes:
              dto.interestNotes !== undefined
                ? assertOptionalText(
                    dto.interestNotes,
                    LOAN_NOTES_MAX_LENGTH,
                    LOAN_ERROR_MESSAGES.INVALID_NOTES,
                  )
                : locked.interestNotes,
            notes:
              dto.notes !== undefined
                ? assertOptionalText(dto.notes, LOAN_NOTES_MAX_LENGTH, LOAN_ERROR_MESSAGES.INVALID_NOTES)
                : locked.notes,
            reference:
              dto.reference !== undefined
                ? assertOptionalText(
                    dto.reference,
                    LOAN_REFERENCE_MAX_LENGTH,
                    LOAN_ERROR_MESSAGES.INVALID_REFERENCE,
                  )
                : locked.reference,
          },
          include: loanInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.LOAN_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.LOAN,
          entityId: row.id,
          before: { status: locked.status },
          after: { status: row.status },
          metadata: { actorUserId },
        });

        return row;
      });

      return this.toLoanView(updated);
    });
  }

  async cancel(company: CompanyContext, loanId: string): Promise<LoanView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const loan = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockLoan(tx, company.companyId, loanId);
        if (locked.status === LoanStatus.CANCELLED) {
          return this.loadLoanDetailInTx(tx, company.companyId, loanId);
        }
        if (locked.status !== LoanStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.LOAN_NOT_CANCELLABLE,
            message: LOAN_ERROR_MESSAGES.NOT_CANCELLABLE,
            statusCode: 409,
          });
        }
        const disbCount = await tx.loanDisbursement.count({
          where: { companyId: company.companyId, loanId },
        });
        if (disbCount > 0) {
          throw new AppError({
            code: ERROR_CODES.LOAN_HAS_DISBURSEMENTS,
            message: LOAN_ERROR_MESSAGES.HAS_DISBURSEMENTS,
            statusCode: 409,
          });
        }

        await tx.loan.update({
          where: { id: locked.id },
          data: {
            status: LoanStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorUserId,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.LOAN_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.LOAN,
          entityId: locked.id,
          before: { status: locked.status },
          after: { status: LoanStatus.CANCELLED },
        });

        return this.loadLoanDetailInTx(tx, company.companyId, loanId);
      });
      return this.toLoanView(loan);
    });
  }

  async createDisbursement(
    company: CompanyContext,
    loanId: string,
    dto: CreateLoanDisbursementDto,
  ): Promise<LoanDisbursementView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const existing = await this.database.client.loanDisbursement.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
        include: { account: { select: accountSelect } },
      });
      if (existing) {
        this.assertDisbursementIdempotent(existing, dto, loanId);
        return this.toDisbursementView(existing);
      }

      try {
        const result = await this.database.client.$transaction(async (tx) => {
          const disb = await this.createDisbursementInTx(
            tx,
            company.companyId,
            loanId,
            dto,
            actorUserId,
            false,
          );
          const loan = await this.loadLoanDetailInTx(tx, company.companyId, loanId);
          return { disb, loan };
        });

        if (result.disb.status === LoanDisbursementStatus.POSTED) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.LOAN_DISBURSED,
              payload: {
                companyId: company.companyId,
                loanId,
                disbursementId: result.disb.id,
                amount: result.disb.amount.toFixed(),
                currency: result.disb.currency,
              },
            }),
          );
        }

        return this.toDisbursementView(result.disb);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const again = await this.database.client.loanDisbursement.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: { account: { select: accountSelect } },
          });
          if (again) {
            this.assertDisbursementIdempotent(again, dto, loanId);
            return this.toDisbursementView(again);
          }
          throw new AppError({
            code: ERROR_CODES.LOAN_DISBURSEMENT_IDEMPOTENCY_CONFLICT,
            message: LOAN_ERROR_MESSAGES.DISBURSEMENT_IDEMPOTENCY_CONFLICT,
            statusCode: 409,
          });
        }
        throw error;
      }
    });
  }

  async postDisbursement(
    company: CompanyContext,
    loanId: string,
    disbursementId: string,
  ): Promise<LoanDisbursementView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const disb = await this.postDisbursementInTx(
          tx,
          company.companyId,
          loanId,
          disbursementId,
          actorUserId,
        );
        return { disb, loan: await this.loadLoanDetailInTx(tx, company.companyId, loanId) };
      });

      if (result.disb.status === LoanDisbursementStatus.POSTED) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.LOAN_DISBURSED,
            payload: {
              companyId: company.companyId,
              loanId,
              disbursementId: result.disb.id,
              amount: result.disb.amount.toFixed(),
              currency: result.disb.currency,
            },
          }),
        );
      }

      return this.toDisbursementView(result.disb);
    });
  }

  async reverseDisbursement(
    company: CompanyContext,
    loanId: string,
    disbursementId: string,
  ): Promise<LoanDisbursementView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        await this.lockLoan(tx, company.companyId, loanId);
        const locked = await this.lockDisbursement(tx, company.companyId, loanId, disbursementId);

        if (locked.status === LoanDisbursementStatus.REVERSED) {
          const existing = await tx.loanDisbursement.findFirst({
            where: { companyId: company.companyId, reversalOfId: locked.id },
            include: { account: { select: accountSelect } },
          });
          if (existing) return existing;
        }
        if (locked.status !== LoanDisbursementStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.LOAN_DISBURSEMENT_NOT_REVERSIBLE,
            message: LOAN_ERROR_MESSAGES.DISBURSEMENT_NOT_REVERSIBLE,
            statusCode: 409,
          });
        }

        const postedRepayments = await tx.loanRepayment.count({
          where: {
            companyId: company.companyId,
            loanId,
            status: LoanRepaymentStatus.POSTED,
            reversalOfId: null,
          },
        });
        if (postedRepayments > 0) {
          throw new AppError({
            code: ERROR_CODES.LOAN_HAS_REPAYMENTS,
            message: LOAN_ERROR_MESSAGES.HAS_REPAYMENTS,
            statusCode: 409,
          });
        }

        const now = new Date();
        const seq = await allocateLoanDisbursementSequence(tx, company.companyId);
        const number = formatLoanDisbursementNumber(seq);

        const reversal = await tx.loanDisbursement.create({
          data: {
            companyId: company.companyId,
            loanId,
            number,
            accountId: locked.accountId,
            amount: locked.amount,
            currency: locked.currency,
            status: LoanDisbursementStatus.POSTED,
            effectiveAt: now,
            notes: `Reversal of ${locked.number}`,
            createdById: actorUserId,
            postedAt: now,
            postedById: actorUserId,
            reversalOfId: locked.id,
          },
          include: { account: { select: accountSelect } },
        });

        await postMovementsInTx(tx, {
          companyId: company.companyId,
          actorUserId,
          checkBalances: true,
          postedAt: now,
          lines: [
            {
              accountId: locked.accountId,
              direction: FinancialAccountMovementDirection.OUT,
              amount: locked.amount,
              currency: locked.currency,
              type: FinancialAccountMovementType.REVERSAL,
              sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.LOAN_DISBURSEMENT,
              sourceId: reversal.id,
              effectiveAt: now,
              description: `Reversal of ${locked.number}`,
            },
          ],
        });

        await tx.loanDisbursement.update({
          where: { id: locked.id },
          data: {
            status: LoanDisbursementStatus.REVERSED,
            reversedAt: now,
            reversedById: actorUserId,
          },
        });

        await this.refreshLoanStatusInTx(tx, company.companyId, loanId, actorUserId);

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.LOAN_DISBURSEMENT_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.LOAN_DISBURSEMENT,
          entityId: locked.id,
          before: { status: LoanDisbursementStatus.POSTED },
          after: { status: LoanDisbursementStatus.REVERSED, reversalId: reversal.id },
        });

        return reversal;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.LOAN_DISBURSEMENT_REVERSED,
          payload: {
            companyId: company.companyId,
            loanId,
            disbursementId,
            reversalId: result.id,
          },
        }),
      );

      return this.toDisbursementView(result);
    });
  }

  async createRepayment(
    company: CompanyContext,
    loanId: string,
    dto: CreateLoanRepaymentDto,
  ): Promise<LoanRepaymentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const existing = await this.database.client.loanRepayment.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
        include: { account: { select: accountSelect } },
      });
      if (existing) {
        this.assertRepaymentIdempotent(existing, dto, loanId);
        return this.toRepaymentView(existing);
      }

      try {
        const result = await this.database.client.$transaction(async (tx) => {
          const repayment = await this.createRepaymentInTx(
            tx,
            company.companyId,
            loanId,
            dto,
            actorUserId,
          );
          const loan = await this.loadLoanDetailInTx(tx, company.companyId, loanId);
          return { repayment, loan };
        });

        if (result.repayment.status === LoanRepaymentStatus.POSTED) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.LOAN_REPAID,
              payload: {
                companyId: company.companyId,
                loanId,
                repaymentId: result.repayment.id,
                principalAmount: result.repayment.principalAmount.toFixed(),
                currency: result.repayment.currency,
              },
            }),
          );
          if (result.loan.status === LoanStatus.SETTLED) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.LOAN_SETTLED,
                payload: { companyId: company.companyId, loanId },
              }),
            );
          }
        }

        return this.toRepaymentView(result.repayment);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const again = await this.database.client.loanRepayment.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: { account: { select: accountSelect } },
          });
          if (again) {
            this.assertRepaymentIdempotent(again, dto, loanId);
            return this.toRepaymentView(again);
          }
          throw new AppError({
            code: ERROR_CODES.LOAN_REPAYMENT_IDEMPOTENCY_CONFLICT,
            message: LOAN_ERROR_MESSAGES.REPAYMENT_IDEMPOTENCY_CONFLICT,
            statusCode: 409,
          });
        }
        throw error;
      }
    });
  }

  async postRepayment(
    company: CompanyContext,
    loanId: string,
    repaymentId: string,
  ): Promise<LoanRepaymentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const repayment = await this.postRepaymentInTx(
          tx,
          company.companyId,
          loanId,
          repaymentId,
          actorUserId,
        );
        return { repayment, loan: await this.loadLoanDetailInTx(tx, company.companyId, loanId) };
      });

      if (result.repayment.status === LoanRepaymentStatus.POSTED) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.LOAN_REPAID,
            payload: {
              companyId: company.companyId,
              loanId,
              repaymentId: result.repayment.id,
              principalAmount: result.repayment.principalAmount.toFixed(),
              currency: result.repayment.currency,
            },
          }),
        );
        if (result.loan.status === LoanStatus.SETTLED) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.LOAN_SETTLED,
              payload: { companyId: company.companyId, loanId },
            }),
          );
        }
      }

      return this.toRepaymentView(result.repayment);
    });
  }

  async reverseRepayment(
    company: CompanyContext,
    loanId: string,
    repaymentId: string,
  ): Promise<LoanRepaymentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        await this.lockLoan(tx, company.companyId, loanId);
        const locked = await this.lockRepayment(tx, company.companyId, loanId, repaymentId);

        if (locked.status === LoanRepaymentStatus.REVERSED) {
          const existing = await tx.loanRepayment.findFirst({
            where: { companyId: company.companyId, reversalOfId: locked.id },
            include: { account: { select: accountSelect } },
          });
          if (existing) return existing;
        }
        if (locked.status !== LoanRepaymentStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.LOAN_REPAYMENT_NOT_REVERSIBLE,
            message: LOAN_ERROR_MESSAGES.REPAYMENT_NOT_REVERSIBLE,
            statusCode: 409,
          });
        }

        const cashOut = locked.principalAmount.plus(locked.interestAmount).plus(locked.feeAmount);
        const now = new Date();
        const seq = await allocateLoanRepaymentSequence(tx, company.companyId);
        const number = formatLoanRepaymentNumber(seq);

        const reversal = await tx.loanRepayment.create({
          data: {
            companyId: company.companyId,
            loanId,
            number,
            accountId: locked.accountId,
            principalAmount: locked.principalAmount,
            interestAmount: locked.interestAmount,
            feeAmount: locked.feeAmount,
            currency: locked.currency,
            status: LoanRepaymentStatus.POSTED,
            effectiveAt: now,
            notes: `Reversal of ${locked.number}`,
            createdById: actorUserId,
            postedAt: now,
            postedById: actorUserId,
            reversalOfId: locked.id,
          },
          include: { account: { select: accountSelect } },
        });

        await postMovementsInTx(tx, {
          companyId: company.companyId,
          actorUserId,
          checkBalances: false,
          postedAt: now,
          lines: [
            {
              accountId: locked.accountId,
              direction: FinancialAccountMovementDirection.IN,
              amount: cashOut,
              currency: locked.currency,
              type: FinancialAccountMovementType.REVERSAL,
              sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.LOAN_REPAYMENT,
              sourceId: reversal.id,
              effectiveAt: now,
              description: `Reversal of ${locked.number}`,
            },
          ],
        });

        await tx.loanRepayment.update({
          where: { id: locked.id },
          data: {
            status: LoanRepaymentStatus.REVERSED,
            reversedAt: now,
            reversedById: actorUserId,
          },
        });

        await this.refreshLoanStatusInTx(tx, company.companyId, loanId, actorUserId);

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.LOAN_REPAYMENT_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.LOAN_REPAYMENT,
          entityId: locked.id,
          before: { status: LoanRepaymentStatus.POSTED },
          after: { status: LoanRepaymentStatus.REVERSED, reversalId: reversal.id },
        });

        return reversal;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.LOAN_REPAYMENT_REVERSED,
          payload: {
            companyId: company.companyId,
            loanId,
            repaymentId,
            reversalId: result.id,
          },
        }),
      );

      return this.toRepaymentView(result);
    });
  }

  private async createDisbursementInTx(
    tx: Tx,
    companyId: string,
    loanId: string,
    dto: {
      accountId: string;
      amount: string;
      effectiveAt?: string;
      notes?: string;
      postImmediately?: boolean;
      requestId: string;
    },
    actorUserId: string,
    skipRequestIdUnique: boolean,
  ) {
    const loan = await this.lockLoan(tx, companyId, loanId);
    if (loan.status === LoanStatus.CANCELLED || loan.status === LoanStatus.REVERSED) {
      throw new AppError({
        code: ERROR_CODES.LOAN_DISBURSEMENT_NOT_POSTABLE,
        message: LOAN_ERROR_MESSAGES.DISBURSEMENT_NOT_POSTABLE,
        statusCode: 409,
      });
    }

    const account = await this.requireActiveAccount(tx, companyId, dto.accountId, loan.currency);
    let amount: Prisma.Decimal;
    try {
      amount = parseMoneyAmount(dto.amount, loan.currency);
    } catch {
      throw AppError.validation(LOAN_ERROR_MESSAGES.INVALID_MONEY);
    }

    const received = await this.sumPostedDisbursements(tx, companyId, loanId);
    if (received.plus(amount).gt(loan.contractedPrincipal)) {
      throw new AppError({
        code: ERROR_CODES.LOAN_OVER_DISBURSE,
        message: LOAN_ERROR_MESSAGES.OVER_DISBURSE,
        statusCode: 409,
      });
    }

    const seq = await allocateLoanDisbursementSequence(tx, companyId);
    const number = formatLoanDisbursementNumber(seq);
    const notes = assertOptionalText(dto.notes, LOAN_NOTES_MAX_LENGTH, LOAN_ERROR_MESSAGES.INVALID_NOTES);
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();

    let disb = await tx.loanDisbursement.create({
      data: {
        companyId,
        loanId,
        number,
        accountId: account.id,
        amount,
        currency: loan.currency,
        status: LoanDisbursementStatus.DRAFT,
        effectiveAt,
        notes,
        requestId: skipRequestIdUnique ? null : dto.requestId,
        createdById: actorUserId,
      },
      include: { account: { select: accountSelect } },
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.LOAN_DISBURSEMENT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.LOAN_DISBURSEMENT,
      entityId: disb.id,
      before: null,
      after: { number: disb.number, amount: amount.toFixed(), status: disb.status },
    });

    if (dto.postImmediately) {
      disb = await this.postDisbursementInTx(tx, companyId, loanId, disb.id, actorUserId);
    }

    return disb;
  }

  private async postDisbursementInTx(
    tx: Tx,
    companyId: string,
    loanId: string,
    disbursementId: string,
    actorUserId: string,
  ) {
    await this.lockLoan(tx, companyId, loanId);
    const locked = await this.lockDisbursement(tx, companyId, loanId, disbursementId);
    if (locked.status === LoanDisbursementStatus.POSTED) {
      return tx.loanDisbursement.findFirstOrThrow({
        where: { id: locked.id, companyId },
        include: { account: { select: accountSelect } },
      });
    }
    if (locked.status !== LoanDisbursementStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.LOAN_DISBURSEMENT_NOT_POSTABLE,
        message: LOAN_ERROR_MESSAGES.DISBURSEMENT_NOT_POSTABLE,
        statusCode: 409,
      });
    }

    const loan = await tx.loan.findFirstOrThrow({ where: { id: loanId, companyId } });
    const received = await this.sumPostedDisbursements(tx, companyId, loanId);
    if (received.plus(locked.amount).gt(loan.contractedPrincipal)) {
      throw new AppError({
        code: ERROR_CODES.LOAN_OVER_DISBURSE,
        message: LOAN_ERROR_MESSAGES.OVER_DISBURSE,
        statusCode: 409,
      });
    }

    await this.requireActiveAccount(tx, companyId, locked.accountId, locked.currency);

    const now = new Date();
    await postMovementsInTx(tx, {
      companyId,
      actorUserId,
      checkBalances: false,
      postedAt: now,
      lines: [
        {
          accountId: locked.accountId,
          direction: FinancialAccountMovementDirection.IN,
          amount: locked.amount,
          currency: locked.currency,
          type: FinancialAccountMovementType.MONEY_IN,
          sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.LOAN_DISBURSEMENT,
          sourceId: locked.id,
          effectiveAt: locked.effectiveAt,
          description: `Loan disbursement ${locked.number}`,
        },
      ],
    });

    const updated = await tx.loanDisbursement.update({
      where: { id: locked.id },
      data: {
        status: LoanDisbursementStatus.POSTED,
        postedAt: now,
        postedById: actorUserId,
      },
      include: { account: { select: accountSelect } },
    });

    await this.refreshLoanStatusInTx(tx, companyId, loanId, actorUserId);

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.LOAN_DISBURSEMENT_POSTED,
      entityType: AUDIT_ENTITY_TYPES.LOAN_DISBURSEMENT,
      entityId: updated.id,
      before: { status: LoanDisbursementStatus.DRAFT },
      after: { status: LoanDisbursementStatus.POSTED },
    });

    return updated;
  }

  private async createRepaymentInTx(
    tx: Tx,
    companyId: string,
    loanId: string,
    dto: CreateLoanRepaymentDto,
    actorUserId: string,
  ) {
    const loan = await this.lockLoan(tx, companyId, loanId);
    await this.requireActiveAccount(tx, companyId, dto.accountId, loan.currency);

    let principalAmount: Prisma.Decimal;
    let interestAmount: Prisma.Decimal;
    let feeAmount: Prisma.Decimal;
    try {
      principalAmount = parseMoneyAmount(dto.principalAmount, loan.currency);
      interestAmount = dto.interestAmount
        ? parseMoneyAmount(dto.interestAmount, loan.currency, { allowZero: true })
        : new Prisma.Decimal(0);
      feeAmount = dto.feeAmount
        ? parseMoneyAmount(dto.feeAmount, loan.currency, { allowZero: true })
        : new Prisma.Decimal(0);
    } catch {
      throw AppError.validation(LOAN_ERROR_MESSAGES.INVALID_MONEY);
    }

    const totals = await this.computeTotalsInTx(tx, companyId, loanId);
    if (principalAmount.gt(totals.outstandingPrincipal)) {
      throw new AppError({
        code: ERROR_CODES.LOAN_OVER_REPAY,
        message: LOAN_ERROR_MESSAGES.OVER_REPAY,
        statusCode: 409,
      });
    }

    const seq = await allocateLoanRepaymentSequence(tx, companyId);
    const number = formatLoanRepaymentNumber(seq);
    const notes = assertOptionalText(dto.notes, LOAN_NOTES_MAX_LENGTH, LOAN_ERROR_MESSAGES.INVALID_NOTES);
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();

    let repayment = await tx.loanRepayment.create({
      data: {
        companyId,
        loanId,
        number,
        accountId: dto.accountId,
        principalAmount,
        interestAmount,
        feeAmount,
        currency: loan.currency,
        status: LoanRepaymentStatus.DRAFT,
        effectiveAt,
        notes,
        requestId: dto.requestId,
        createdById: actorUserId,
      },
      include: { account: { select: accountSelect } },
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.LOAN_REPAYMENT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.LOAN_REPAYMENT,
      entityId: repayment.id,
      before: null,
      after: {
        number: repayment.number,
        principalAmount: principalAmount.toFixed(),
        status: repayment.status,
      },
    });

    if (dto.postImmediately) {
      repayment = await this.postRepaymentInTx(tx, companyId, loanId, repayment.id, actorUserId);
    }

    return repayment;
  }

  private async postRepaymentInTx(
    tx: Tx,
    companyId: string,
    loanId: string,
    repaymentId: string,
    actorUserId: string,
  ) {
    await this.lockLoan(tx, companyId, loanId);
    const locked = await this.lockRepayment(tx, companyId, loanId, repaymentId);
    if (locked.status === LoanRepaymentStatus.POSTED) {
      return tx.loanRepayment.findFirstOrThrow({
        where: { id: locked.id, companyId },
        include: { account: { select: accountSelect } },
      });
    }
    if (locked.status !== LoanRepaymentStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.LOAN_REPAYMENT_NOT_POSTABLE,
        message: LOAN_ERROR_MESSAGES.REPAYMENT_NOT_POSTABLE,
        statusCode: 409,
      });
    }

    const totals = await this.computeTotalsInTx(tx, companyId, loanId);
    if (locked.principalAmount.gt(totals.outstandingPrincipal)) {
      throw new AppError({
        code: ERROR_CODES.LOAN_OVER_REPAY,
        message: LOAN_ERROR_MESSAGES.OVER_REPAY,
        statusCode: 409,
      });
    }

    await this.requireActiveAccount(tx, companyId, locked.accountId, locked.currency);
    const cashOut = locked.principalAmount.plus(locked.interestAmount).plus(locked.feeAmount);
    const now = new Date();

    await postMovementsInTx(tx, {
      companyId,
      actorUserId,
      checkBalances: true,
      postedAt: now,
      lines: [
        {
          accountId: locked.accountId,
          direction: FinancialAccountMovementDirection.OUT,
          amount: cashOut,
          currency: locked.currency,
          type: FinancialAccountMovementType.MONEY_OUT,
          sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.LOAN_REPAYMENT,
          sourceId: locked.id,
          effectiveAt: locked.effectiveAt,
          description: `Loan repayment ${locked.number}`,
        },
      ],
    });

    const updated = await tx.loanRepayment.update({
      where: { id: locked.id },
      data: {
        status: LoanRepaymentStatus.POSTED,
        postedAt: now,
        postedById: actorUserId,
      },
      include: { account: { select: accountSelect } },
    });

    await this.refreshLoanStatusInTx(tx, companyId, loanId, actorUserId);

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.LOAN_REPAYMENT_POSTED,
      entityType: AUDIT_ENTITY_TYPES.LOAN_REPAYMENT,
      entityId: updated.id,
      before: { status: LoanRepaymentStatus.DRAFT },
      after: { status: LoanRepaymentStatus.POSTED },
    });

    return updated;
  }

  private async refreshLoanStatusInTx(
    tx: Tx,
    companyId: string,
    loanId: string,
    actorUserId: string,
  ): Promise<void> {
    const loan = await tx.loan.findFirstOrThrow({ where: { id: loanId, companyId } });
    if (loan.status === LoanStatus.CANCELLED || loan.status === LoanStatus.REVERSED) {
      return;
    }
    const totals = await this.computeTotalsInTx(tx, companyId, loanId);
    const next = deriveLoanOperationalStatus({
      receivedPrincipal: totals.receivedPrincipal,
      outstandingPrincipal: totals.outstandingPrincipal,
      currentStatus: loan.status,
    });
    const settledAt =
      next === LoanStatus.SETTLED ? loan.settledAt ?? new Date() : next === LoanStatus.DRAFT ? null : loan.settledAt;

    await tx.loan.update({
      where: { id: loanId },
      data: {
        status: next,
        settledAt,
        postedAt: totals.receivedPrincipal.gt(0) ? loan.postedAt ?? new Date() : loan.postedAt,
        postedById: totals.receivedPrincipal.gt(0) ? loan.postedById ?? actorUserId : loan.postedById,
      },
    });

    if (next === LoanStatus.SETTLED && loan.status !== LoanStatus.SETTLED) {
      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.LOAN_SETTLED,
        entityType: AUDIT_ENTITY_TYPES.LOAN,
        entityId: loanId,
        before: { status: loan.status },
        after: { status: LoanStatus.SETTLED },
      });
    }
  }

  private async computeTotalsInTx(tx: Tx, companyId: string, loanId: string) {
    const disbursements = await tx.loanDisbursement.findMany({
      where: {
        companyId,
        loanId,
        status: LoanDisbursementStatus.POSTED,
        reversalOfId: null,
      },
      select: { amount: true },
    });
    const repayments = await tx.loanRepayment.findMany({
      where: {
        companyId,
        loanId,
        status: LoanRepaymentStatus.POSTED,
        reversalOfId: null,
      },
      select: { principalAmount: true },
    });
    return deriveLoanPrincipalTotals({
      postedDisbursementAmounts: disbursements.map((d) => d.amount),
      postedPrincipalRepayments: repayments.map((r) => r.principalAmount),
    });
  }

  private async sumPostedDisbursements(tx: Tx, companyId: string, loanId: string) {
    const totals = await this.computeTotalsInTx(tx, companyId, loanId);
    return totals.receivedPrincipal;
  }

  private async requireActiveAccount(
    tx: Tx,
    companyId: string,
    accountId: string,
    currency: CurrencyCode,
  ) {
    const account = await tx.financialAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!account) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND,
        message: 'Financial account not found.',
        statusCode: 404,
      });
    }
    if (account.status !== FinancialAccountStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.LOAN_ACCOUNT_INACTIVE,
        message: LOAN_ERROR_MESSAGES.ACCOUNT_INACTIVE,
        statusCode: 409,
      });
    }
    if (account.currency !== currency) {
      throw new AppError({
        code: ERROR_CODES.LOAN_CROSS_CURRENCY,
        message: LOAN_ERROR_MESSAGES.CROSS_CURRENCY,
        statusCode: 409,
      });
    }
    return account;
  }

  private async lockLoan(tx: Tx, companyId: string, loanId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM loans
      WHERE company_id = ${companyId}::uuid AND id = ${loanId}::uuid
      FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new AppError({
        code: ERROR_CODES.LOAN_NOT_FOUND,
        message: LOAN_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return tx.loan.findFirstOrThrow({ where: { id: loanId, companyId } });
  }

  private async lockDisbursement(tx: Tx, companyId: string, loanId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM loan_disbursements
      WHERE company_id = ${companyId}::uuid AND loan_id = ${loanId}::uuid AND id = ${id}::uuid
      FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new AppError({
        code: ERROR_CODES.LOAN_DISBURSEMENT_NOT_FOUND,
        message: LOAN_ERROR_MESSAGES.DISBURSEMENT_NOT_FOUND,
        statusCode: 404,
      });
    }
    return tx.loanDisbursement.findFirstOrThrow({ where: { id, companyId, loanId } });
  }

  private async lockRepayment(tx: Tx, companyId: string, loanId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM loan_repayments
      WHERE company_id = ${companyId}::uuid AND loan_id = ${loanId}::uuid AND id = ${id}::uuid
      FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new AppError({
        code: ERROR_CODES.LOAN_REPAYMENT_NOT_FOUND,
        message: LOAN_ERROR_MESSAGES.REPAYMENT_NOT_FOUND,
        statusCode: 404,
      });
    }
    return tx.loanRepayment.findFirstOrThrow({ where: { id, companyId, loanId } });
  }

  private async requireLoanDetail(companyId: string, loanId: string): Promise<LoanDetail> {
    const row = await this.database.client.loan.findFirst({
      where: { id: loanId, companyId },
      include: loanInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.LOAN_NOT_FOUND,
        message: LOAN_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadLoanDetailInTx(tx: Tx, companyId: string, loanId: string): Promise<LoanDetail> {
    return tx.loan.findFirstOrThrow({
      where: { id: loanId, companyId },
      include: loanInclude,
    });
  }

  private assertLenderName(value: string): string {
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length === 0 || name.length > LOAN_LENDER_NAME_MAX_LENGTH) {
      throw AppError.validation(LOAN_ERROR_MESSAGES.INVALID_LENDER_NAME);
    }
    return name;
  }

  private assertLoanIdempotent(
    existing: LoanDetail,
    dto: CreateLoanDto,
    contractedPrincipal: Prisma.Decimal,
  ): void {
    if (
      existing.lenderType !== dto.lenderType ||
      existing.currency !== dto.currency ||
      !existing.contractedPrincipal.eq(contractedPrincipal)
    ) {
      throw new AppError({
        code: ERROR_CODES.LOAN_IDEMPOTENCY_CONFLICT,
        message: LOAN_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private assertDisbursementIdempotent(
    existing: { loanId: string; accountId: string; amount: Prisma.Decimal },
    dto: CreateLoanDisbursementDto,
    loanId: string,
  ): void {
    if (existing.loanId !== loanId || existing.accountId !== dto.accountId) {
      throw new AppError({
        code: ERROR_CODES.LOAN_DISBURSEMENT_IDEMPOTENCY_CONFLICT,
        message: LOAN_ERROR_MESSAGES.DISBURSEMENT_IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private assertRepaymentIdempotent(
    existing: { loanId: string; accountId: string; principalAmount: Prisma.Decimal },
    dto: CreateLoanRepaymentDto,
    loanId: string,
  ): void {
    if (existing.loanId !== loanId || existing.accountId !== dto.accountId) {
      throw new AppError({
        code: ERROR_CODES.LOAN_REPAYMENT_IDEMPOTENCY_CONFLICT,
        message: LOAN_ERROR_MESSAGES.REPAYMENT_IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private toLoanView(row: LoanDetail): LoanView {
    const totals = deriveLoanPrincipalTotals({
      postedDisbursementAmounts: row.disbursements
        .filter((d) => d.status === LoanDisbursementStatus.POSTED && !d.reversalOfId)
        .map((d) => d.amount),
      postedPrincipalRepayments: row.repayments
        .filter((r) => r.status === LoanRepaymentStatus.POSTED && !r.reversalOfId)
        .map((r) => r.principalAmount),
    });
    const overdue = isLoanOverdue({
      dueDate: row.dueDate,
      outstandingPrincipal: totals.outstandingPrincipal,
    });

    return {
      id: row.id,
      number: row.number,
      lenderType: row.lenderType,
      lenderId: row.lenderId,
      lenderName: row.lenderName,
      currency: row.currency,
      contractedPrincipal: row.contractedPrincipal.toFixed(),
      receivedPrincipal: totals.receivedPrincipal.toFixed(),
      repaidPrincipal: totals.repaidPrincipal.toFixed(),
      outstandingPrincipal: totals.outstandingPrincipal.toFixed(),
      overdue,
      referenceFxRate: row.referenceFxRate?.toFixed() ?? null,
      referenceFxBaseCurrency: row.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: row.referenceFxQuoteCurrency,
      dueDate: row.dueDate?.toISOString() ?? null,
      interestRate: row.interestRate?.toFixed() ?? null,
      interestNotes: row.interestNotes,
      feeAmount: row.feeAmount?.toFixed() ?? null,
      notes: row.notes,
      reference: row.reference,
      status: row.status,
      receivingAccount: row.receivingAccount,
      requestId: row.requestId,
      postedAt: row.postedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      reversedAt: row.reversedAt?.toISOString() ?? null,
      settledAt: row.settledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      disbursements: row.disbursements.map((d) => this.toDisbursementView(d)),
      repayments: row.repayments.map((r) => this.toRepaymentView(r)),
    };
  }

  private toDisbursementView(
    row: Prisma.LoanDisbursementGetPayload<{ include: { account: { select: typeof accountSelect } } }>,
  ): LoanDisbursementView {
    return {
      id: row.id,
      number: row.number,
      loanId: row.loanId,
      account: row.account,
      amount: row.amount.toFixed(),
      currency: row.currency,
      status: row.status,
      effectiveAt: row.effectiveAt.toISOString(),
      notes: row.notes,
      requestId: row.requestId,
      postedAt: row.postedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      reversedAt: row.reversedAt?.toISOString() ?? null,
      reversalOfId: row.reversalOfId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRepaymentView(
    row: Prisma.LoanRepaymentGetPayload<{ include: { account: { select: typeof accountSelect } } }>,
  ): LoanRepaymentView {
    const cashOut = row.principalAmount.plus(row.interestAmount).plus(row.feeAmount);
    return {
      id: row.id,
      number: row.number,
      loanId: row.loanId,
      account: row.account,
      principalAmount: row.principalAmount.toFixed(),
      interestAmount: row.interestAmount.toFixed(),
      feeAmount: row.feeAmount.toFixed(),
      cashOutAmount: cashOut.toFixed(),
      currency: row.currency,
      status: row.status,
      effectiveAt: row.effectiveAt.toISOString(),
      notes: row.notes,
      requestId: row.requestId,
      postedAt: row.postedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      reversedAt: row.reversedAt?.toISOString() ?? null,
      reversalOfId: row.reversalOfId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authenticated actor is required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}
