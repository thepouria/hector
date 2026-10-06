import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  JournalEntryStatus,
  JournalLineDirection,
  LedgerAccountStatus,
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
import {
  JOURNAL_EFFECT_TYPES,
  JOURNAL_ERROR_MESSAGES,
  JOURNAL_SOURCE_TYPES,
} from './finance-journals.constants';
import {
  assertJournalLinesBalanced,
  type JournalLineDraftInput,
} from './journal-balance';
import {
  allocateJournalSequence,
  formatJournalNumber,
} from './journal-numbering';
import type {
  CreateManualJournalDto,
  GeneralLedgerQueryDto,
  ListJournalsQueryDto,
  ListLedgerQueryDto,
  TrialBalanceQueryDto,
} from './dto/journal.dto';
import {
  computeRunningBalances,
  signedBaseDelta,
} from './general-ledger-running-balance';
import type {
  GeneralLedgerLineView,
  GeneralLedgerView,
  JournalEntryView,
  LedgerLineView,
  TrialBalanceRowView,
} from './types/finance-journal.types';

type Tx = Prisma.TransactionClient;

const detailInclude = {
  lines: {
    orderBy: [{ lineOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    include: {
      ledgerAccount: {
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          systemKey: true,
        },
      },
    },
  },
} satisfies Prisma.JournalEntryInclude;

type DetailRow = Prisma.JournalEntryGetPayload<{ include: typeof detailInclude }>;

export type PostJournalInTxInput = {
  companyId: string;
  actorUserId: string;
  description: string;
  reference?: string | null;
  sourceType: string;
  sourceId: string | null;
  effectType: string;
  effectiveAt: Date;
  baseCurrency: CurrencyCode;
  lines: JournalLineDraftInput[];
  requestId?: string | null;
  /** When true, create as POSTED immediately. Default true for automatic builders. */
  postImmediately?: boolean;
  status?: JournalEntryStatus;
};

@Injectable()
export class JournalPostingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListJournalsQueryDto,
  ): Promise<{ data: JournalEntryView[]; meta: PaginationMeta }> {
    const where: Prisma.JournalEntryWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.effectType ? { effectType: query.effectType } : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              { reference: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.journalEntry.count({ where }),
      this.database.client.journalEntry.findMany({
        where,
        orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize,
        include: detailInclude,
      }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, id: string): Promise<JournalEntryView> {
    const row = await this.database.client.journalEntry.findFirst({
      where: { id, companyId: company.companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.JOURNAL_NOT_FOUND,
        message: JOURNAL_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return this.toView(row);
  }

  async createManual(
    company: CompanyContext,
    dto: CreateManualJournalDto,
  ): Promise<JournalEntryView> {
    const actorUserId = this.requireActorUserId();
    const companyRow = await this.database.client.company.findFirstOrThrow({
      where: { id: company.companyId },
      select: { baseCurrency: true },
    });

    return commitThenPublish(this.eventBus, async (events) => {
      if (dto.requestId) {
        const existing = await this.database.client.journalEntry.findFirst({
          where: { companyId: company.companyId, requestId: dto.requestId },
          include: detailInclude,
        });
        if (existing) return this.toView(existing);
      }

      const lines: JournalLineDraftInput[] = dto.lines.map((line, index) => ({
        ledgerAccountId: line.ledgerAccountId,
        direction: line.direction,
        originalAmount: new Prisma.Decimal(line.originalAmount),
        originalCurrency: line.originalCurrency,
        baseAmount: new Prisma.Decimal(line.baseAmount),
        baseCurrency: companyRow.baseCurrency,
        fxRate: line.fxRate ? new Prisma.Decimal(line.fxRate) : null,
        fxRateSource: line.fxRateSource ?? null,
        description: line.description ?? null,
        lineOrder: index,
      }));

      const result = await this.database.client.$transaction(async (tx) => {
        return this.postInTx(tx, {
          companyId: company.companyId,
          actorUserId,
          description: dto.description.trim(),
          reference: dto.reference?.trim() || null,
          sourceType: JOURNAL_SOURCE_TYPES.MANUAL_JOURNAL,
          sourceId: null,
          effectType: JOURNAL_EFFECT_TYPES.MANUAL,
          effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : new Date(),
          baseCurrency: companyRow.baseCurrency,
          lines,
          requestId: dto.requestId ?? null,
          postImmediately: dto.postImmediately === true,
        });
      });

      if (result.status === JournalEntryStatus.POSTED) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.JOURNAL_POSTED,
            payload: {
              companyId: company.companyId,
              journalEntryId: result.id,
              number: result.number,
              effectType: result.effectType,
            },
          }),
        );
      }

      return this.toView(
        await this.database.client.journalEntry.findFirstOrThrow({
          where: { id: result.id, companyId: company.companyId },
          include: detailInclude,
        }),
      );
    });
  }

  async post(company: CompanyContext, id: string): Promise<JournalEntryView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockEntry(tx, company.companyId, id);
        if (locked.status === JournalEntryStatus.POSTED) {
          return this.loadDetailInTx(tx, company.companyId, id);
        }
        if (locked.status !== JournalEntryStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.JOURNAL_NOT_POSTABLE,
            message: JOURNAL_ERROR_MESSAGES.NOT_POSTABLE,
            statusCode: 409,
          });
        }
        const lines = await tx.journalLine.findMany({
          where: { companyId: company.companyId, journalEntryId: id },
        });
        assertJournalLinesBalanced(lines);
        const now = new Date();
        const updated = await tx.journalEntry.update({
          where: { id },
          data: {
            status: JournalEntryStatus.POSTED,
            postedAt: now,
            postedById: actorUserId,
          },
          include: detailInclude,
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.JOURNAL_POSTED,
          entityType: AUDIT_ENTITY_TYPES.JOURNAL_ENTRY,
          entityId: updated.id,
          before: { status: JournalEntryStatus.DRAFT },
          after: { status: JournalEntryStatus.POSTED },
        });
        return updated;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.JOURNAL_POSTED,
          payload: {
            companyId: company.companyId,
            journalEntryId: row.id,
            number: row.number,
            effectType: row.effectType,
          },
        }),
      );
      return this.toView(row);
    });
  }

  async reverse(company: CompanyContext, id: string): Promise<JournalEntryView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        return this.reverseInTx(tx, company.companyId, id, actorUserId);
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.JOURNAL_REVERSED,
          payload: {
            companyId: company.companyId,
            journalEntryId: result.original.id,
            reversalJournalEntryId: result.reversal.id,
            number: result.original.number,
          },
        }),
      );

      return this.toView(result.reversal);
    });
  }

  /**
   * Core posting primitive — call inside an existing domain TX.
   * Creates DRAFT or POSTED journal with balanced lines. Never creates AccountMovement.
   */
  async postInTx(tx: Tx, input: PostJournalInTxInput): Promise<{
    id: string;
    number: string;
    status: JournalEntryStatus;
    effectType: string;
  }> {
    if (input.sourceId) {
      const existing = await tx.journalEntry.findFirst({
        where: {
          companyId: input.companyId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          effectType: input.effectType,
          status: {
            in: [
              JournalEntryStatus.DRAFT,
              JournalEntryStatus.POSTED,
              JournalEntryStatus.REVERSED,
            ],
          },
        },
      });
      if (existing) {
        return {
          id: existing.id,
          number: existing.number,
          status: existing.status,
          effectType: existing.effectType,
        };
      }
    }

    if (input.requestId) {
      const byRequest = await tx.journalEntry.findFirst({
        where: { companyId: input.companyId, requestId: input.requestId },
      });
      if (byRequest) {
        return {
          id: byRequest.id,
          number: byRequest.number,
          status: byRequest.status,
          effectType: byRequest.effectType,
        };
      }
    }

    const { totalDebitBase, totalCreditBase } = (() => {
      try {
        return assertJournalLinesBalanced(input.lines);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : JOURNAL_ERROR_MESSAGES.UNBALANCED;
        throw new AppError({
          code: ERROR_CODES.JOURNAL_UNBALANCED,
          message,
          statusCode: 400,
        });
      }
    })();

    for (const line of input.lines) {
      if (line.baseCurrency !== input.baseCurrency) {
        throw new AppError({
          code: ERROR_CODES.JOURNAL_CROSS_COMPANY,
          message: JOURNAL_ERROR_MESSAGES.CROSS_COMPANY,
          statusCode: 409,
        });
      }
      if (line.originalAmount.lte(0) || line.baseAmount.lte(0)) {
        throw new AppError({
          code: ERROR_CODES.JOURNAL_INVALID_LINE_AMOUNT,
          message: JOURNAL_ERROR_MESSAGES.INVALID_LINE_AMOUNT,
          statusCode: 400,
        });
      }
      const account = await tx.ledgerAccount.findFirst({
        where: {
          id: line.ledgerAccountId,
          companyId: input.companyId,
        },
      });
      if (!account) {
        throw new AppError({
          code: ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
          message: JOURNAL_ERROR_MESSAGES.LEDGER_ACCOUNT_NOT_FOUND,
          statusCode: 404,
        });
      }
      if (account.status !== LedgerAccountStatus.ACTIVE) {
        throw new AppError({
          code: ERROR_CODES.LEDGER_ACCOUNT_INACTIVE,
          message: JOURNAL_ERROR_MESSAGES.LEDGER_ACCOUNT_INACTIVE,
          statusCode: 409,
        });
      }
    }

    const seq = await allocateJournalSequence(tx, input.companyId);
    const number = formatJournalNumber(seq);
    const postImmediately = input.postImmediately !== false;
    const now = new Date();

    const entry = await tx.journalEntry.create({
      data: {
        companyId: input.companyId,
        number,
        status: postImmediately
          ? JournalEntryStatus.POSTED
          : JournalEntryStatus.DRAFT,
        effectiveAt: input.effectiveAt,
        description: input.description,
        reference: input.reference ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        effectType: input.effectType,
        baseCurrency: input.baseCurrency,
        totalDebitBase,
        totalCreditBase,
        requestId: input.requestId ?? null,
        createdById: input.actorUserId,
        postedAt: postImmediately ? now : null,
        postedById: postImmediately ? input.actorUserId : null,
      },
    });

    await tx.journalLine.createMany({
      data: input.lines.map((line, index) => ({
        companyId: input.companyId,
        journalEntryId: entry.id,
        ledgerAccountId: line.ledgerAccountId,
        direction: line.direction,
        originalAmount: line.originalAmount,
        originalCurrency: line.originalCurrency,
        baseAmount: line.baseAmount,
        baseCurrency: line.baseCurrency,
        fxRate: line.fxRate ?? null,
        fxRateSource: line.fxRateSource ?? null,
        description: line.description ?? null,
        lineOrder: line.lineOrder ?? index,
      })),
    });

    await this.auditService.record(tx, {
      action: postImmediately
        ? AUDIT_ACTIONS.JOURNAL_POSTED
        : AUDIT_ACTIONS.JOURNAL_CREATED,
      entityType: AUDIT_ENTITY_TYPES.JOURNAL_ENTRY,
      entityId: entry.id,
      before: null,
      after: {
        number: entry.number,
        status: entry.status,
        sourceType: entry.sourceType,
        effectType: entry.effectType,
        totalDebitBase: totalDebitBase.toFixed(),
        totalCreditBase: totalCreditBase.toFixed(),
      },
    });

    return {
      id: entry.id,
      number: entry.number,
      status: entry.status,
      effectType: entry.effectType,
    };
  }

  async reverseInTx(
    tx: Tx,
    companyId: string,
    journalEntryId: string,
    actorUserId: string,
  ): Promise<{ original: DetailRow; reversal: DetailRow }> {
    const locked = await this.lockEntry(tx, companyId, journalEntryId);

    const existingReversal = await tx.journalEntry.findFirst({
      where: { companyId, reversalOfId: locked.id },
      include: detailInclude,
    });
    if (existingReversal) {
      return {
        original: await this.loadDetailInTx(tx, companyId, journalEntryId),
        reversal: existingReversal,
      };
    }

    if (locked.status === JournalEntryStatus.REVERSED) {
      throw new AppError({
        code: ERROR_CODES.JOURNAL_ALREADY_REVERSED,
        message: JOURNAL_ERROR_MESSAGES.ALREADY_REVERSED,
        statusCode: 409,
      });
    }
    if (locked.status !== JournalEntryStatus.POSTED) {
      throw new AppError({
        code: ERROR_CODES.JOURNAL_NOT_REVERSIBLE,
        message: JOURNAL_ERROR_MESSAGES.NOT_REVERSIBLE,
        statusCode: 409,
      });
    }

    const original = await this.loadDetailInTx(tx, companyId, journalEntryId);
    const now = new Date();
    const reverseLines: JournalLineDraftInput[] = original.lines.map(
      (line, index) => ({
        ledgerAccountId: line.ledgerAccountId,
        direction:
          line.direction === JournalLineDirection.DEBIT
            ? JournalLineDirection.CREDIT
            : JournalLineDirection.DEBIT,
        originalAmount: line.originalAmount,
        originalCurrency: line.originalCurrency,
        baseAmount: line.baseAmount,
        baseCurrency: line.baseCurrency,
        fxRate: line.fxRate,
        fxRateSource: line.fxRateSource,
        description: `Reversal of ${original.number}`,
        lineOrder: index,
      }),
    );

    const posted = await this.postInTx(tx, {
      companyId,
      actorUserId,
      description: `Reversal of ${original.number}`,
      reference: original.reference,
      sourceType: JOURNAL_SOURCE_TYPES.JOURNAL_REVERSAL,
      sourceId: original.id,
      effectType: JOURNAL_EFFECT_TYPES.REVERSAL,
      effectiveAt: now,
      baseCurrency: original.baseCurrency,
      lines: reverseLines,
      postImmediately: true,
    });

    await tx.journalEntry.update({
      where: { id: posted.id },
      data: { reversalOfId: original.id },
    });

    await tx.journalEntry.update({
      where: { id: original.id },
      data: {
        status: JournalEntryStatus.REVERSED,
        reversedAt: now,
        reversedById: actorUserId,
      },
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.JOURNAL_REVERSED,
      entityType: AUDIT_ENTITY_TYPES.JOURNAL_ENTRY,
      entityId: original.id,
      before: { status: JournalEntryStatus.POSTED },
      after: {
        status: JournalEntryStatus.REVERSED,
        reversalId: posted.id,
      },
    });

    return {
      original: await this.loadDetailInTx(tx, companyId, original.id),
      reversal: await this.loadDetailInTx(tx, companyId, posted.id),
    };
  }

  /**
   * Reverse the posted journal for a domain source effect (idempotent).
   */
  async reverseBySourceInTx(
    tx: Tx,
    input: {
      companyId: string;
      actorUserId: string;
      sourceType: string;
      sourceId: string;
      effectType: string;
    },
  ): Promise<void> {
    const entry = await tx.journalEntry.findFirst({
      where: {
        companyId: input.companyId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        effectType: input.effectType,
        status: JournalEntryStatus.POSTED,
      },
    });
    if (!entry) return;
    await this.reverseInTx(tx, input.companyId, entry.id, input.actorUserId);
  }

  async listLedger(
    company: CompanyContext,
    query: ListLedgerQueryDto,
  ): Promise<{ data: LedgerLineView[]; meta: PaginationMeta }> {
    const where: Prisma.JournalLineWhereInput = {
      companyId: company.companyId,
      ...(query.ledgerAccountId
        ? { ledgerAccountId: query.ledgerAccountId }
        : {}),
      journalEntry: {
        status: JournalEntryStatus.POSTED,
        ...(query.from || query.to
          ? {
              effectiveAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.journalLine.count({ where }),
      this.database.client.journalLine.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: query.pageSize,
        include: {
          ledgerAccount: {
            select: { id: true, code: true, name: true, type: true },
          },
          journalEntry: {
            select: {
              id: true,
              number: true,
              effectiveAt: true,
              description: true,
              sourceType: true,
              effectType: true,
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        journalEntryId: row.journalEntryId,
        journalNumber: row.journalEntry.number,
        effectiveAt: row.journalEntry.effectiveAt.toISOString(),
        description: row.description ?? row.journalEntry.description,
        ledgerAccountId: row.ledgerAccountId,
        ledgerAccountCode: row.ledgerAccount.code,
        ledgerAccountName: row.ledgerAccount.name,
        direction: row.direction,
        originalAmount: row.originalAmount.toFixed(),
        originalCurrency: row.originalCurrency,
        baseAmount: row.baseAmount.toFixed(),
        baseCurrency: row.baseCurrency,
        fxRate: row.fxRate?.toFixed() ?? null,
        sourceType: row.journalEntry.sourceType,
        effectType: row.journalEntry.effectType,
      })),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  /**
   * General ledger for one CoA account: POSTED lines, chronological,
   * server-derived running balance in company base currency.
   */
  async generalLedger(
    company: CompanyContext,
    query: GeneralLedgerQueryDto,
  ): Promise<GeneralLedgerView & { meta: PaginationMeta }> {
    const account = await this.database.client.ledgerAccount.findFirst({
      where: { id: query.ledgerAccountId, companyId: company.companyId },
      select: { id: true, code: true, name: true, type: true },
    });
    if (!account) {
      throw new AppError({
        code: ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
        message: JOURNAL_ERROR_MESSAGES.LEDGER_ACCOUNT_NOT_FOUND,
        statusCode: 404,
      });
    }

    const companyRow = await this.database.client.company.findFirstOrThrow({
      where: { id: company.companyId },
      select: { baseCurrency: true },
    });

    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : null;
    const dateTo = query.dateTo ? new Date(query.dateTo) : null;

    const rangeWhere: Prisma.JournalLineWhereInput = {
      companyId: company.companyId,
      ledgerAccountId: query.ledgerAccountId,
      journalEntry: {
        status: JournalEntryStatus.POSTED,
        ...(dateFrom || dateTo
          ? {
              effectiveAt: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
    };

    // Opening = sum of signed base amounts for POSTED lines before dateFrom
    // (or before the first line of this page when dateFrom is absent and page > 1).
    let openingBalanceBase = new Prisma.Decimal(0);
    if (dateFrom) {
      const priorLines = await this.database.client.journalLine.findMany({
        where: {
          companyId: company.companyId,
          ledgerAccountId: query.ledgerAccountId,
          journalEntry: {
            status: JournalEntryStatus.POSTED,
            effectiveAt: { lt: dateFrom },
          },
        },
        select: { direction: true, baseAmount: true },
      });
      for (const line of priorLines) {
        openingBalanceBase = openingBalanceBase.plus(signedBaseDelta(line));
      }
    }

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.journalLine.count({ where: rangeWhere }),
      this.database.client.journalLine.findMany({
        where: rangeWhere,
        orderBy: [
          { journalEntry: { effectiveAt: 'asc' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        skip,
        take: query.pageSize,
        include: {
          ledgerAccount: {
            select: { id: true, code: true, name: true, type: true },
          },
          journalEntry: {
            select: {
              id: true,
              number: true,
              effectiveAt: true,
              description: true,
              sourceType: true,
              effectType: true,
            },
          },
        },
      }),
    ]);

    // When paginating without dateFrom (or after dateFrom opening), add prior pages.
    if (skip > 0) {
      const priorPageRows = await this.database.client.journalLine.findMany({
        where: rangeWhere,
        orderBy: [
          { journalEntry: { effectiveAt: 'asc' } },
          { createdAt: 'asc' },
          { id: 'asc' },
        ],
        take: skip,
        select: { direction: true, baseAmount: true },
      });
      for (const line of priorPageRows) {
        openingBalanceBase = openingBalanceBase.plus(signedBaseDelta(line));
      }
    }

    const { runningBalances, closingBalanceBase } = computeRunningBalances(
      openingBalanceBase,
      rows,
    );

    const data: GeneralLedgerLineView[] = rows.map((row, index) => ({
      id: row.id,
      journalEntryId: row.journalEntryId,
      journalNumber: row.journalEntry.number,
      effectiveAt: row.journalEntry.effectiveAt.toISOString(),
      description: row.description ?? row.journalEntry.description,
      ledgerAccountId: row.ledgerAccountId,
      ledgerAccountCode: row.ledgerAccount.code,
      ledgerAccountName: row.ledgerAccount.name,
      direction: row.direction,
      originalAmount: row.originalAmount.toFixed(),
      originalCurrency: row.originalCurrency,
      baseAmount: row.baseAmount.toFixed(),
      baseCurrency: row.baseCurrency,
      fxRate: row.fxRate?.toFixed() ?? null,
      sourceType: row.journalEntry.sourceType,
      effectType: row.journalEntry.effectType,
      runningBalanceBase: runningBalances[index]!,
    }));

    return {
      ledgerAccount: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
      },
      baseCurrency: companyRow.baseCurrency,
      openingBalanceBase: openingBalanceBase.toFixed(),
      closingBalanceBase,
      data,
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async trialBalance(
    company: CompanyContext,
    query: TrialBalanceQueryDto,
  ): Promise<{ data: TrialBalanceRowView[]; baseCurrency: CurrencyCode }> {
    const companyRow = await this.database.client.company.findFirstOrThrow({
      where: { id: company.companyId },
      select: { baseCurrency: true },
    });

    const asOf = query.asOf ? new Date(query.asOf) : null;
    const lines = await this.database.client.journalLine.findMany({
      where: {
        companyId: company.companyId,
        journalEntry: {
          status: JournalEntryStatus.POSTED,
          ...(asOf ? { effectiveAt: { lte: asOf } } : {}),
        },
      },
      include: {
        ledgerAccount: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            systemKey: true,
          },
        },
      },
    });

    const buckets = new Map<
      string,
      {
        ledgerAccountId: string;
        code: string;
        name: string;
        type: string;
        systemKey: string | null;
        debitBase: Prisma.Decimal;
        creditBase: Prisma.Decimal;
      }
    >();

    for (const line of lines) {
      let bucket = buckets.get(line.ledgerAccountId);
      if (!bucket) {
        bucket = {
          ledgerAccountId: line.ledgerAccountId,
          code: line.ledgerAccount.code,
          name: line.ledgerAccount.name,
          type: line.ledgerAccount.type,
          systemKey: line.ledgerAccount.systemKey,
          debitBase: new Prisma.Decimal(0),
          creditBase: new Prisma.Decimal(0),
        };
        buckets.set(line.ledgerAccountId, bucket);
      }
      if (line.direction === JournalLineDirection.DEBIT) {
        bucket.debitBase = bucket.debitBase.plus(line.baseAmount);
      } else {
        bucket.creditBase = bucket.creditBase.plus(line.baseAmount);
      }
    }

    const data = [...buckets.values()]
      .map((b) => ({
        ledgerAccountId: b.ledgerAccountId,
        code: b.code,
        name: b.name,
        type: b.type,
        systemKey: b.systemKey,
        debitBase: b.debitBase.toFixed(),
        creditBase: b.creditBase.toFixed(),
        netBase: b.debitBase.minus(b.creditBase).toFixed(),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

    return { data, baseCurrency: companyRow.baseCurrency };
  }

  private async lockEntry(tx: Tx, companyId: string, id: string) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: JournalEntryStatus }>
    >(Prisma.sql`
      SELECT id, status FROM journal_entries
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.JOURNAL_NOT_FOUND,
        message: JOURNAL_ERROR_MESSAGES.NOT_FOUND,
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
    return tx.journalEntry.findFirstOrThrow({
      where: { id, companyId },
      include: detailInclude,
    });
  }

  private toView(row: DetailRow): JournalEntryView {
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      effectiveAt: row.effectiveAt.toISOString(),
      description: row.description,
      reference: row.reference,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      effectType: row.effectType,
      baseCurrency: row.baseCurrency,
      totalDebitBase: row.totalDebitBase.toFixed(),
      totalCreditBase: row.totalCreditBase.toFixed(),
      reversalOfId: row.reversalOfId,
      requestId: row.requestId,
      postedAt: row.postedAt?.toISOString() ?? null,
      reversedAt: row.reversedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      lines: row.lines.map((line) => ({
        id: line.id,
        ledgerAccountId: line.ledgerAccountId,
        ledgerAccountCode: line.ledgerAccount.code,
        ledgerAccountName: line.ledgerAccount.name,
        ledgerAccountType: line.ledgerAccount.type,
        systemKey: line.ledgerAccount.systemKey,
        direction: line.direction,
        originalAmount: line.originalAmount.toFixed(),
        originalCurrency: line.originalCurrency,
        baseAmount: line.baseAmount.toFixed(),
        baseCurrency: line.baseCurrency,
        fxRate: line.fxRate?.toFixed() ?? null,
        fxRateSource: line.fxRateSource,
        description: line.description,
        lineOrder: line.lineOrder,
      })),
    };
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Unauthorized',
        statusCode: 401,
      });
    }
    return userId;
  }
}
