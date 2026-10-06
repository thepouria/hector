import { Injectable } from '@nestjs/common';
import {
  CapitalContributionStatus,
  CapitalFundingType,
  CurrencyCode,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
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
  allocateCapitalContributionSequence,
  formatCapitalContributionNumber,
} from './capital-loan-numbering';
import { FINANCE_ACCOUNT_SOURCE_TYPES } from './finance-accounts.constants';
import {
  CAPITAL_CONTRIBUTION_ERROR_MESSAGES,
  CAPITAL_CONTRIBUTOR_NAME_MAX_LENGTH,
  CAPITAL_NOTES_MAX_LENGTH,
  CAPITAL_REFERENCE_MAX_LENGTH,
} from './finance-capital-loans.constants';
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import { parseMoneyAmount } from './money/money';
import { JournalPostingService } from './journal-posting.service';
import { LedgerAccountsService } from './ledger-accounts.service';
import { postCapitalJournalInTx } from './journal-builders';
import {
  JOURNAL_EFFECT_TYPES,
  JOURNAL_SOURCE_TYPES,
} from './finance-journals.constants';
import type {
  CreateCapitalContributionDto,
  ListCapitalContributionsQueryDto,
  UpdateCapitalContributionDto,
} from './dto/capital-contribution.dto';
import type {
  CapitalContributionView,
  CapitalSummaryView,
} from './types/finance-capital-loan.types';

const detailInclude = {
  account: {
    select: { id: true, code: true, name: true, currency: true, status: true },
  },
} satisfies Prisma.CapitalContributionInclude;

type DetailRow = Prisma.CapitalContributionGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class CapitalContributionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly journalPosting: JournalPostingService,
    private readonly ledgerAccounts: LedgerAccountsService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListCapitalContributionsQueryDto,
  ): Promise<{ data: CapitalContributionView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const where: Prisma.CapitalContributionWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.fundingType ? { fundingType: query.fundingType } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { contributorName: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.capitalContribution.count({ where }),
      this.database.client.capitalContribution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        include: detailInclude,
      }),
    ]);

    return {
      data: rows.map((row) => this.toView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, id: string): Promise<CapitalContributionView> {
    return this.toView(await this.requireDetail(company.companyId, id));
  }

  async summary(company: CompanyContext): Promise<CapitalSummaryView> {
    const rows = await this.database.client.capitalContribution.findMany({
      where: {
        companyId: company.companyId,
        status: CapitalContributionStatus.POSTED,
        reversalOfId: null,
      },
      select: { currency: true, fundingType: true, amount: true },
    });

    const byCurrency = new Map<
      CurrencyCode,
      { total: Prisma.Decimal; byType: Map<CapitalFundingType, Prisma.Decimal> }
    >();

    for (const row of rows) {
      let bucket = byCurrency.get(row.currency);
      if (!bucket) {
        bucket = { total: new Prisma.Decimal(0), byType: new Map() };
        byCurrency.set(row.currency, bucket);
      }
      bucket.total = bucket.total.plus(row.amount);
      bucket.byType.set(
        row.fundingType,
        (bucket.byType.get(row.fundingType) ?? new Prisma.Decimal(0)).plus(row.amount),
      );
    }

    return {
      byCurrency: [...byCurrency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, bucket]) => ({
          currency,
          total: bucket.total.toFixed(),
          byFundingType: [...bucket.byType.entries()].map(([fundingType, total]) => ({
            fundingType,
            total: total.toFixed(),
          })),
        })),
    };
  }

  async create(
    company: CompanyContext,
    dto: CreateCapitalContributionDto,
  ): Promise<CapitalContributionView> {
    const actorUserId = this.requireActorUserId();
    this.assertOtherFundingNotes(dto.fundingType, dto.notes);
    const contributorName = this.assertContributorName(dto.contributorName);
    const notes = assertOptionalText(
      dto.notes,
      CAPITAL_NOTES_MAX_LENGTH,
      CAPITAL_CONTRIBUTION_ERROR_MESSAGES.INVALID_NOTES,
    );
    const reference = assertOptionalText(
      dto.reference,
      CAPITAL_REFERENCE_MAX_LENGTH,
      CAPITAL_CONTRIBUTION_ERROR_MESSAGES.INVALID_REFERENCE,
    );
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();
    const postImmediately = dto.postImmediately === true;

    return commitThenPublish(this.eventBus, async (events) => {
      const existing = await this.database.client.capitalContribution.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
        include: detailInclude,
      });
      if (existing) {
        this.assertIdempotentCreate(existing, dto);
        return this.toView(existing);
      }

      try {
        const result = await this.database.client.$transaction(async (tx) => {
          const { account, amount } = await this.loadAndValidateAccount(
            tx,
            company.companyId,
            dto.accountId,
            dto.amount,
          );

          const seq = await allocateCapitalContributionSequence(tx, company.companyId);
          const number = formatCapitalContributionNumber(seq);

          let row = await tx.capitalContribution.create({
            data: {
              companyId: company.companyId,
              number,
              fundingType: dto.fundingType,
              contributorType: dto.contributorType,
              contributorId: dto.contributorId ?? null,
              contributorName,
              accountId: account.id,
              amount,
              currency: account.currency,
              status: CapitalContributionStatus.DRAFT,
              effectiveAt,
              reference,
              notes,
              requestId: dto.requestId,
              createdById: actorUserId,
            },
            include: detailInclude,
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.CAPITAL_CONTRIBUTION_CREATED,
            entityType: AUDIT_ENTITY_TYPES.CAPITAL_CONTRIBUTION,
            entityId: row.id,
            before: null,
            after: {
              number: row.number,
              fundingType: row.fundingType,
              amount: amount.toFixed(),
              currency: row.currency,
              status: row.status,
            },
          });

          let posted = false;
          if (postImmediately) {
            row = await this.postInTx(tx, company.companyId, row.id, actorUserId);
            posted = true;
          }

          return { row, posted };
        });

        if (result.posted) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.CAPITAL_INJECTED,
              payload: {
                companyId: company.companyId,
                capitalContributionId: result.row.id,
                number: result.row.number,
                fundingType: result.row.fundingType,
                amount: result.row.amount.toFixed(),
                currency: result.row.currency,
                accountId: result.row.accountId,
              },
            }),
          );
        }

        return this.toView(result.row);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const again = await this.database.client.capitalContribution.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: detailInclude,
          });
          if (again) {
            this.assertIdempotentCreate(again, dto);
            return this.toView(again);
          }
          throw new AppError({
            code: ERROR_CODES.CAPITAL_CONTRIBUTION_IDEMPOTENCY_CONFLICT,
            message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
            statusCode: 409,
          });
        }
        throw error;
      }
    });
  }

  async update(
    company: CompanyContext,
    id: string,
    dto: UpdateCapitalContributionDto,
  ): Promise<CapitalContributionView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockContribution(tx, company.companyId, id);
        if (locked.status !== CapitalContributionStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.CAPITAL_CONTRIBUTION_NOT_EDITABLE,
            message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }

        const fundingType = dto.fundingType ?? locked.fundingType;
        const notes =
          dto.notes !== undefined
            ? assertOptionalText(
                dto.notes,
                CAPITAL_NOTES_MAX_LENGTH,
                CAPITAL_CONTRIBUTION_ERROR_MESSAGES.INVALID_NOTES,
              )
            : locked.notes;
        this.assertOtherFundingNotes(fundingType, notes);

        let accountId = locked.accountId;
        let amount = locked.amount;
        let currency = locked.currency;
        if (dto.accountId || dto.amount) {
          const validated = await this.loadAndValidateAccount(
            tx,
            company.companyId,
            dto.accountId ?? locked.accountId,
            dto.amount ?? locked.amount.toFixed(),
          );
          accountId = validated.account.id;
          amount = validated.amount;
          currency = validated.account.currency;
        }

        const row = await tx.capitalContribution.update({
          where: { id: locked.id },
          data: {
            fundingType,
            contributorType: dto.contributorType ?? locked.contributorType,
            contributorId:
              dto.contributorId !== undefined ? dto.contributorId : locked.contributorId,
            contributorName:
              dto.contributorName !== undefined
                ? this.assertContributorName(dto.contributorName)
                : locked.contributorName,
            accountId,
            amount,
            currency,
            effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : locked.effectiveAt,
            reference:
              dto.reference !== undefined
                ? assertOptionalText(
                    dto.reference,
                    CAPITAL_REFERENCE_MAX_LENGTH,
                    CAPITAL_CONTRIBUTION_ERROR_MESSAGES.INVALID_REFERENCE,
                  )
                : locked.reference,
            notes,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.CAPITAL_CONTRIBUTION_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.CAPITAL_CONTRIBUTION,
          entityId: row.id,
          before: { status: locked.status, amount: locked.amount.toFixed() },
          after: { status: row.status, amount: row.amount.toFixed() },
          metadata: { actorUserId },
        });

        return row;
      });

      return this.toView(updated);
    });
  }

  async post(company: CompanyContext, id: string): Promise<CapitalContributionView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        return this.postInTx(tx, company.companyId, id, actorUserId);
      });

      if (row.status === CapitalContributionStatus.POSTED) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CAPITAL_INJECTED,
            payload: {
              companyId: company.companyId,
              capitalContributionId: row.id,
              number: row.number,
              fundingType: row.fundingType,
              amount: row.amount.toFixed(),
              currency: row.currency,
              accountId: row.accountId,
            },
          }),
        );
      }

      return this.toView(row);
    });
  }

  async cancel(company: CompanyContext, id: string): Promise<CapitalContributionView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const row = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockContribution(tx, company.companyId, id);
        if (locked.status === CapitalContributionStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, id);
        }
        if (locked.status !== CapitalContributionStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.CAPITAL_CONTRIBUTION_NOT_CANCELLABLE,
            message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.NOT_CANCELLABLE,
            statusCode: 409,
          });
        }

        const updated = await tx.capitalContribution.update({
          where: { id: locked.id },
          data: {
            status: CapitalContributionStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.CAPITAL_CONTRIBUTION_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.CAPITAL_CONTRIBUTION,
          entityId: updated.id,
          before: { status: locked.status },
          after: { status: updated.status },
        });

        return updated;
      });

      return this.toView(row);
    });
  }

  async reverse(company: CompanyContext, id: string): Promise<CapitalContributionView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockContribution(tx, company.companyId, id);
        if (locked.status === CapitalContributionStatus.REVERSED) {
          const existingReversal = await tx.capitalContribution.findFirst({
            where: { companyId: company.companyId, reversalOfId: locked.id },
            include: detailInclude,
          });
          if (existingReversal) {
            return {
              original: await this.loadDetailInTx(tx, company.companyId, id),
              reversal: existingReversal,
            };
          }
        }
        if (locked.status !== CapitalContributionStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.CAPITAL_CONTRIBUTION_NOT_REVERSIBLE,
            message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.NOT_REVERSIBLE,
            statusCode: 409,
          });
        }

        const now = new Date();
        const seq = await allocateCapitalContributionSequence(tx, company.companyId);
        const number = formatCapitalContributionNumber(seq);

        const reversal = await tx.capitalContribution.create({
          data: {
            companyId: company.companyId,
            number,
            fundingType: locked.fundingType,
            contributorType: locked.contributorType,
            contributorId: locked.contributorId,
            contributorName: locked.contributorName,
            accountId: locked.accountId,
            amount: locked.amount,
            currency: locked.currency,
            status: CapitalContributionStatus.POSTED,
            effectiveAt: now,
            notes: `Reversal of ${locked.number}`,
            createdById: actorUserId,
            postedAt: now,
            postedById: actorUserId,
            reversalOfId: locked.id,
          },
          include: detailInclude,
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
              sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.CAPITAL_INJECTION,
              sourceId: reversal.id,
              effectiveAt: now,
              description: `Reversal of ${locked.number}`,
            },
          ],
        });

        await this.journalPosting.reverseBySourceInTx(tx, {
          companyId: company.companyId,
          actorUserId,
          sourceType: JOURNAL_SOURCE_TYPES.CAPITAL_CONTRIBUTION,
          sourceId: locked.id,
          effectType: JOURNAL_EFFECT_TYPES.CAPITAL_POST,
        });

        const original = await tx.capitalContribution.update({
          where: { id: locked.id },
          data: {
            status: CapitalContributionStatus.REVERSED,
            reversedAt: now,
            reversedById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.CAPITAL_CONTRIBUTION_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.CAPITAL_CONTRIBUTION,
          entityId: original.id,
          before: { status: CapitalContributionStatus.POSTED },
          after: {
            status: CapitalContributionStatus.REVERSED,
            reversalId: reversal.id,
          },
        });

        return { original, reversal };
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CAPITAL_CONTRIBUTION_REVERSED,
          payload: {
            companyId: company.companyId,
            capitalContributionId: result.original.id,
            reversalId: result.reversal.id,
            number: result.original.number,
          },
        }),
      );

      return this.toView(result.original);
    });
  }

  private async postInTx(
    tx: Tx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<DetailRow> {
    const locked = await this.lockContribution(tx, companyId, id);
    if (locked.status === CapitalContributionStatus.POSTED) {
      return this.loadDetailInTx(tx, companyId, id);
    }
    if (locked.status !== CapitalContributionStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.CAPITAL_CONTRIBUTION_NOT_POSTABLE,
        message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.NOT_POSTABLE,
        statusCode: 409,
      });
    }

    this.assertOtherFundingNotes(locked.fundingType, locked.notes);

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
          sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.CAPITAL_INJECTION,
          sourceId: locked.id,
          effectiveAt: locked.effectiveAt,
          description: `Capital ${locked.number}`,
        },
      ],
    });

    await postCapitalJournalInTx(
      tx,
      { journals: this.journalPosting, ledger: this.ledgerAccounts },
      {
        companyId,
        actorUserId,
        capitalContributionId: locked.id,
        accountId: locked.accountId,
        amount: locked.amount,
        currency: locked.currency,
        effectiveAt: locked.effectiveAt,
        number: locked.number,
      },
    );

    const updated = await tx.capitalContribution.update({
      where: { id: locked.id },
      data: {
        status: CapitalContributionStatus.POSTED,
        postedAt: now,
        postedById: actorUserId,
      },
      include: detailInclude,
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.CAPITAL_CONTRIBUTION_POSTED,
      entityType: AUDIT_ENTITY_TYPES.CAPITAL_CONTRIBUTION,
      entityId: updated.id,
      before: { status: CapitalContributionStatus.DRAFT },
      after: {
        status: CapitalContributionStatus.POSTED,
        amount: locked.amount.toFixed(),
        currency: locked.currency,
      },
    });

    return updated;
  }

  private async loadAndValidateAccount(
    tx: Tx,
    companyId: string,
    accountId: string,
    amountRaw: string,
  ): Promise<{
    account: { id: string; currency: CurrencyCode; status: FinancialAccountStatus };
    amount: Prisma.Decimal;
  }> {
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
        code: ERROR_CODES.CAPITAL_CONTRIBUTION_ACCOUNT_INACTIVE,
        message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.ACCOUNT_INACTIVE,
        statusCode: 409,
      });
    }

    let amount: Prisma.Decimal;
    try {
      amount = parseMoneyAmount(amountRaw, account.currency);
    } catch {
      throw AppError.validation(CAPITAL_CONTRIBUTION_ERROR_MESSAGES.INVALID_MONEY);
    }

    return { account, amount };
  }

  private assertOtherFundingNotes(
    fundingType: CapitalFundingType,
    notes: string | null | undefined,
  ): void {
    if (fundingType === CapitalFundingType.OTHER_FUNDING && !notes?.trim()) {
      throw new AppError({
        code: ERROR_CODES.CAPITAL_CONTRIBUTION_OTHER_FUNDING_REQUIRES_NOTES,
        message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.OTHER_FUNDING_REQUIRES_NOTES,
        statusCode: 400,
      });
    }
  }

  private assertContributorName(value: string): string {
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length === 0 || name.length > CAPITAL_CONTRIBUTOR_NAME_MAX_LENGTH) {
      throw AppError.validation(CAPITAL_CONTRIBUTION_ERROR_MESSAGES.INVALID_CONTRIBUTOR_NAME);
    }
    return name;
  }

  private assertIdempotentCreate(
    existing: DetailRow,
    dto: CreateCapitalContributionDto,
  ): void {
    if (
      existing.fundingType !== dto.fundingType ||
      existing.contributorType !== dto.contributorType ||
      existing.accountId !== dto.accountId ||
      existing.amount.toFixed() !== parseMoneyAmount(dto.amount, existing.currency).toFixed()
    ) {
      throw new AppError({
        code: ERROR_CODES.CAPITAL_CONTRIBUTION_IDEMPOTENCY_CONFLICT,
        message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private async lockContribution(tx: Tx, companyId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM capital_contributions
      WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid
      FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new AppError({
        code: ERROR_CODES.CAPITAL_CONTRIBUTION_NOT_FOUND,
        message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return tx.capitalContribution.findFirstOrThrow({
      where: { id, companyId },
    });
  }

  private async requireDetail(companyId: string, id: string): Promise<DetailRow> {
    const row = await this.database.client.capitalContribution.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.CAPITAL_CONTRIBUTION_NOT_FOUND,
        message: CAPITAL_CONTRIBUTION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(tx: Tx, companyId: string, id: string): Promise<DetailRow> {
    return tx.capitalContribution.findFirstOrThrow({
      where: { id, companyId },
      include: detailInclude,
    });
  }

  private toView(row: DetailRow): CapitalContributionView {
    return {
      id: row.id,
      number: row.number,
      fundingType: row.fundingType,
      contributorType: row.contributorType,
      contributorId: row.contributorId,
      contributorName: row.contributorName,
      account: row.account,
      amount: row.amount.toFixed(),
      currency: row.currency,
      status: row.status,
      effectiveAt: row.effectiveAt.toISOString(),
      reference: row.reference,
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
