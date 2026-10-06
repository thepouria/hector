import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
  FxConversionStatus,
  FxRateType,
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
import { lockAccountsForUpdate } from './accounts.balance';
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import {
  FX_CONVERSION_ERROR_MESSAGES,
  FX_CONVERSION_NOTES_MAX_LENGTH,
  FX_RATE_ERROR_MESSAGES,
} from './finance-fx.constants';
import { FINANCE_ACCOUNT_SOURCE_TYPES } from './finance-accounts.constants';
import {
  allocateFxConversionSequence,
  formatFxConversionNumber,
} from './fx-conversion-numbering';
import {
  amountsMatchWithinRounding,
  previewConvertAmount,
} from './fx-helpers';
import { describeFxQuote, parseFxRate } from './money/fx-rate';
import { parseMoneyAmount } from './money/money';
import type {
  CreateFxConversionDto,
  FxConvertPreviewDto,
  ListFxConversionsQueryDto,
} from './dto/fx.dto';
import type { FxConversionView, FxConvertPreviewView } from './types/finance-fx.types';

const detailInclude = {
  sourceAccount: {
    select: { id: true, code: true, name: true, currency: true, status: true },
  },
  destinationAccount: {
    select: { id: true, code: true, name: true, currency: true, status: true },
  },
} satisfies Prisma.FxConversionInclude;

type DetailRow = Prisma.FxConversionGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class FxConversionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListFxConversionsQueryDto,
  ): Promise<{ data: FxConversionView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const where: Prisma.FxConversionWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceAccountId ? { sourceAccountId: query.sourceAccountId } : {}),
      ...(query.destinationAccountId
        ? { destinationAccountId: query.destinationAccountId }
        : {}),
      ...(query.fromCurrency ? { fromCurrency: query.fromCurrency } : {}),
      ...(query.toCurrency ? { toCurrency: query.toCurrency } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              { sourceAccount: { code: { contains: search, mode: 'insensitive' } } },
              { destinationAccount: { code: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.fxConversion.count({ where }),
      this.database.client.fxConversion.findMany({
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

  async get(company: CompanyContext, conversionId: string): Promise<FxConversionView> {
    return this.toView(await this.requireDetail(company.companyId, conversionId));
  }

  preview(dto: FxConvertPreviewDto): FxConvertPreviewView {
    if (dto.fromCurrency === dto.toCurrency) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_SAME_CURRENCY,
        message: FX_CONVERSION_ERROR_MESSAGES.SAME_CURRENCY,
        statusCode: 400,
      });
    }
    let appliedRate: Prisma.Decimal;
    try {
      appliedRate = parseFxRate(dto.appliedRate);
    } catch {
      throw new AppError({
        code: ERROR_CODES.FX_RATE_INVALID,
        message: FX_RATE_ERROR_MESSAGES.INVALID_RATE,
        statusCode: 400,
      });
    }
    if (appliedRate.lte(0)) {
      throw new AppError({
        code: ERROR_CODES.FX_RATE_ZERO,
        message: FX_RATE_ERROR_MESSAGES.ZERO_RATE,
        statusCode: 400,
      });
    }

    let fromAmount: Prisma.Decimal;
    try {
      fromAmount = parseMoneyAmount(dto.fromAmount, dto.fromCurrency);
    } catch {
      throw AppError.validation('Invalid fromAmount for fromCurrency.');
    }

    let converted;
    try {
      converted = previewConvertAmount({
        fromAmount,
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
        rateBaseCurrency: dto.rateBaseCurrency,
        rateQuoteCurrency: dto.rateQuoteCurrency,
        appliedRate,
      });
    } catch {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_RATE_PAIR_MISMATCH,
        message: FX_CONVERSION_ERROR_MESSAGES.RATE_PAIR_MISMATCH,
        statusCode: 400,
      });
    }

    return {
      fromAmount: fromAmount.toFixed(),
      fromCurrency: dto.fromCurrency,
      toAmount: converted.amount.toFixed(),
      toCurrency: dto.toCurrency,
      appliedRate: appliedRate.toFixed(),
      rateBaseCurrency: dto.rateBaseCurrency,
      rateQuoteCurrency: dto.rateQuoteCurrency,
      rateDisplay: describeFxQuote({
        baseCurrency: dto.rateBaseCurrency,
        quoteCurrency: dto.rateQuoteCurrency,
        rate: appliedRate,
      }),
    };
  }

  async create(
    company: CompanyContext,
    dto: CreateFxConversionDto,
  ): Promise<FxConversionView> {
    const actorUserId = this.requireActorUserId();
    const notes = assertOptionalText(
      dto.notes,
      FX_CONVERSION_NOTES_MAX_LENGTH,
      FX_CONVERSION_ERROR_MESSAGES.INVALID_NOTES,
    );
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();
    const postImmediately = dto.postImmediately === true;

    if (dto.sourceAccountId === dto.destinationAccountId) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_SAME_ACCOUNT,
        message: FX_CONVERSION_ERROR_MESSAGES.SAME_ACCOUNT,
        statusCode: 400,
      });
    }
    if (dto.fromCurrency === dto.toCurrency) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_SAME_CURRENCY,
        message: FX_CONVERSION_ERROR_MESSAGES.SAME_CURRENCY,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const existing = await this.database.client.fxConversion.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
        include: detailInclude,
      });
      if (existing) {
        this.assertIdempotentPayload(existing, dto);
        return this.toView(existing);
      }

      try {
        const result = await this.database.client.$transaction(async (tx) => {
          const parsed = await this.parseAndValidateCreate(tx, company.companyId, dto);

          const seq = await allocateFxConversionSequence(tx, company.companyId);
          const number = formatFxConversionNumber(seq);

          let conversion = await tx.fxConversion.create({
            data: {
              companyId: company.companyId,
              number,
              sourceAccountId: parsed.source.id,
              destinationAccountId: parsed.destination.id,
              fromAmount: parsed.fromAmount,
              fromCurrency: parsed.fromCurrency,
              toAmount: parsed.toAmount,
              toCurrency: parsed.toCurrency,
              appliedRate: parsed.appliedRate,
              rateBaseCurrency: parsed.rateBaseCurrency,
              rateQuoteCurrency: parsed.rateQuoteCurrency,
              rateType: FxRateType.CONVERSION,
              fxRateId: parsed.fxRateId,
              feeAmount: parsed.feeAmount,
              feeCurrency: parsed.feeCurrency,
              feeAccountId: parsed.feeAccountId,
              status: FxConversionStatus.DRAFT,
              effectiveAt,
              notes,
              requestId: dto.requestId,
              createdById: actorUserId,
            },
            include: detailInclude,
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.FX_CONVERSION_CREATED,
            entityType: AUDIT_ENTITY_TYPES.FX_CONVERSION,
            entityId: conversion.id,
            before: null,
            after: {
              number: conversion.number,
              fromAmount: parsed.fromAmount.toFixed(),
              fromCurrency: parsed.fromCurrency,
              toAmount: parsed.toAmount.toFixed(),
              toCurrency: parsed.toCurrency,
              appliedRate: parsed.appliedRate.toFixed(),
              status: conversion.status,
            },
          });

          let posted = false;
          if (postImmediately) {
            conversion = await this.postInTx(tx, company.companyId, conversion.id, actorUserId);
            posted = true;
          }

          return { conversion, posted };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.FX_CONVERSION_CREATED,
            payload: {
              companyId: company.companyId,
              conversionId: result.conversion.id,
              number: result.conversion.number,
              status: result.conversion.status,
            },
          }),
        );

        if (result.posted) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.FX_CONVERSION_POSTED,
              payload: {
                companyId: company.companyId,
                conversionId: result.conversion.id,
                number: result.conversion.number,
                fromAmount: result.conversion.fromAmount.toFixed(),
                fromCurrency: result.conversion.fromCurrency,
                toAmount: result.conversion.toAmount.toFixed(),
                toCurrency: result.conversion.toCurrency,
              },
            }),
          );
        }

        return this.toView(result.conversion);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const again = await this.database.client.fxConversion.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: detailInclude,
          });
          if (again) {
            this.assertIdempotentPayload(again, dto);
            return this.toView(again);
          }
          throw new AppError({
            code: ERROR_CODES.FX_CONVERSION_IDEMPOTENCY_CONFLICT,
            message: FX_CONVERSION_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
            statusCode: 409,
          });
        }
        throw error;
      }
    });
  }

  async post(company: CompanyContext, conversionId: string): Promise<FxConversionView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const conversion = await this.database.client.$transaction(async (tx) => {
        return this.postInTx(tx, company.companyId, conversionId, actorUserId);
      });

      if (conversion.status === FxConversionStatus.POSTED) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.FX_CONVERSION_POSTED,
            payload: {
              companyId: company.companyId,
              conversionId: conversion.id,
              number: conversion.number,
              fromAmount: conversion.fromAmount.toFixed(),
              fromCurrency: conversion.fromCurrency,
              toAmount: conversion.toAmount.toFixed(),
              toCurrency: conversion.toCurrency,
            },
          }),
        );
      }

      return this.toView(conversion);
    });
  }

  async cancel(company: CompanyContext, conversionId: string): Promise<FxConversionView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const conversion = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockConversion(tx, company.companyId, conversionId);
        if (locked.status === FxConversionStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, conversionId);
        }
        if (locked.status !== FxConversionStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.FX_CONVERSION_NOT_CANCELLABLE,
            message: FX_CONVERSION_ERROR_MESSAGES.NOT_CANCELLABLE,
            statusCode: 409,
          });
        }

        const updated = await tx.fxConversion.update({
          where: { id: locked.id },
          data: {
            status: FxConversionStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.FX_CONVERSION_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.FX_CONVERSION,
          entityId: updated.id,
          before: { status: locked.status },
          after: { status: updated.status },
        });

        return updated;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.FX_CONVERSION_CANCELLED,
          payload: {
            companyId: company.companyId,
            conversionId: conversion.id,
            number: conversion.number,
          },
        }),
      );

      return this.toView(conversion);
    });
  }

  /**
   * Administrative reverse uses ORIGINAL from/to/fee amounts (not market rate).
   */
  async reverse(company: CompanyContext, conversionId: string): Promise<FxConversionView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockConversion(tx, company.companyId, conversionId);
        if (locked.status === FxConversionStatus.REVERSED) {
          const existingReversal = await tx.fxConversion.findFirst({
            where: { companyId: company.companyId, reversalOfId: locked.id },
            include: detailInclude,
          });
          if (existingReversal) {
            return {
              original: await this.loadDetailInTx(tx, company.companyId, conversionId),
              reversal: existingReversal,
            };
          }
        }
        if (locked.status !== FxConversionStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.FX_CONVERSION_NOT_REVERSIBLE,
            message: FX_CONVERSION_ERROR_MESSAGES.NOT_REVERSIBLE,
            statusCode: 409,
          });
        }

        const accountIds = [
          locked.sourceAccountId,
          locked.destinationAccountId,
          ...(locked.feeAccountId ? [locked.feeAccountId] : []),
        ];
        await lockAccountsForUpdate(tx, company.companyId, accountIds);

        const now = new Date();
        const seq = await allocateFxConversionSequence(tx, company.companyId);
        const number = formatFxConversionNumber(seq);

        // Reversal document: swap source/destination; keep ORIGINAL amounts.
        const reversal = await tx.fxConversion.create({
          data: {
            companyId: company.companyId,
            number,
            sourceAccountId: locked.destinationAccountId,
            destinationAccountId: locked.sourceAccountId,
            fromAmount: locked.toAmount,
            fromCurrency: locked.toCurrency,
            toAmount: locked.fromAmount,
            toCurrency: locked.fromCurrency,
            appliedRate: locked.appliedRate,
            rateBaseCurrency: locked.rateBaseCurrency,
            rateQuoteCurrency: locked.rateQuoteCurrency,
            rateType: FxRateType.CONVERSION,
            fxRateId: locked.fxRateId,
            feeAmount: locked.feeAmount,
            feeCurrency: locked.feeCurrency,
            feeAccountId: locked.feeAccountId,
            status: FxConversionStatus.POSTED,
            effectiveAt: now,
            notes: `Reversal of ${locked.number}`,
            createdById: actorUserId,
            postedAt: now,
            postedById: actorUserId,
            reversalOfId: locked.id,
          },
          include: detailInclude,
        });

        const lines = [
          {
            accountId: locked.destinationAccountId,
            direction: FinancialAccountMovementDirection.OUT,
            amount: locked.toAmount,
            currency: locked.toCurrency,
            type: FinancialAccountMovementType.REVERSAL,
            sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.FX_CONVERSION,
            sourceId: reversal.id,
            effectiveAt: now,
            description: `Reversal of ${locked.number}`,
          },
          {
            accountId: locked.sourceAccountId,
            direction: FinancialAccountMovementDirection.IN,
            amount: locked.fromAmount,
            currency: locked.fromCurrency,
            type: FinancialAccountMovementType.REVERSAL,
            sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.FX_CONVERSION,
            sourceId: reversal.id,
            effectiveAt: now,
            description: `Reversal of ${locked.number}`,
          },
        ];

        if (
          locked.feeAmount &&
          locked.feeCurrency &&
          locked.feeAccountId &&
          locked.feeAmount.gt(0)
        ) {
          // Reverse fee: MONEY_IN back to fee account (original was OUT).
          lines.push({
            accountId: locked.feeAccountId,
            direction: FinancialAccountMovementDirection.IN,
            amount: locked.feeAmount,
            currency: locked.feeCurrency,
            type: FinancialAccountMovementType.REVERSAL,
            sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.FX_CONVERSION,
            sourceId: reversal.id,
            effectiveAt: now,
            description: `Fee reversal of ${locked.number}`,
          });
        }

        await postMovementsInTx(tx, {
          companyId: company.companyId,
          actorUserId,
          lines,
          checkBalances: true,
          postedAt: now,
        });

        const original = await tx.fxConversion.update({
          where: { id: locked.id },
          data: {
            status: FxConversionStatus.REVERSED,
            reversedAt: now,
            reversedById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.FX_CONVERSION_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.FX_CONVERSION,
          entityId: original.id,
          before: { status: locked.status },
          after: {
            status: original.status,
            reversalId: reversal.id,
            reversalNumber: reversal.number,
          },
        });

        return { original, reversal };
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.FX_CONVERSION_REVERSED,
          payload: {
            companyId: company.companyId,
            conversionId: result.original.id,
            number: result.original.number,
            reversalId: result.reversal.id,
            reversalNumber: result.reversal.number,
          },
        }),
      );

      return this.toView(result.original);
    });
  }

  private async postInTx(
    tx: Tx,
    companyId: string,
    conversionId: string,
    actorUserId: string,
  ): Promise<DetailRow> {
    const locked = await this.lockConversion(tx, companyId, conversionId);
    if (locked.status === FxConversionStatus.POSTED) {
      return this.loadDetailInTx(tx, companyId, conversionId);
    }
    if (locked.status !== FxConversionStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_NOT_POSTABLE,
        message: FX_CONVERSION_ERROR_MESSAGES.NOT_POSTABLE,
        statusCode: 409,
      });
    }

    // Re-verify arithmetic at post time.
    const expected = previewConvertAmount({
      fromAmount: locked.fromAmount,
      fromCurrency: locked.fromCurrency,
      toCurrency: locked.toCurrency,
      rateBaseCurrency: locked.rateBaseCurrency,
      rateQuoteCurrency: locked.rateQuoteCurrency,
      appliedRate: locked.appliedRate,
    });
    if (!amountsMatchWithinRounding(expected.amount, locked.toAmount)) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_ARITHMETIC_MISMATCH,
        message: FX_CONVERSION_ERROR_MESSAGES.ARITHMETIC_MISMATCH,
        statusCode: 409,
      });
    }

    const accountIds = [
      locked.sourceAccountId,
      locked.destinationAccountId,
      ...(locked.feeAccountId ? [locked.feeAccountId] : []),
    ];
    await lockAccountsForUpdate(tx, companyId, accountIds);

    const now = new Date();
    const lines = [
      {
        accountId: locked.sourceAccountId,
        direction: FinancialAccountMovementDirection.OUT,
        amount: locked.fromAmount,
        currency: locked.fromCurrency,
        type: FinancialAccountMovementType.MONEY_OUT,
        sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.FX_CONVERSION,
        sourceId: locked.id,
        effectiveAt: locked.effectiveAt,
        description: `FX ${locked.number} out`,
      },
      {
        accountId: locked.destinationAccountId,
        direction: FinancialAccountMovementDirection.IN,
        amount: locked.toAmount,
        currency: locked.toCurrency,
        type: FinancialAccountMovementType.MONEY_IN,
        sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.FX_CONVERSION,
        sourceId: locked.id,
        effectiveAt: locked.effectiveAt,
        description: `FX ${locked.number} in`,
      },
    ];

    if (
      locked.feeAmount &&
      locked.feeCurrency &&
      locked.feeAccountId &&
      locked.feeAmount.gt(0)
    ) {
      lines.push({
        accountId: locked.feeAccountId,
        direction: FinancialAccountMovementDirection.OUT,
        amount: locked.feeAmount,
        currency: locked.feeCurrency,
        type: FinancialAccountMovementType.MONEY_OUT,
        sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.FX_CONVERSION,
        sourceId: locked.id,
        effectiveAt: locked.effectiveAt,
        description: `FX ${locked.number} fee`,
      });
    }

    await postMovementsInTx(tx, {
      companyId,
      actorUserId,
      lines,
      checkBalances: true,
      postedAt: now,
    });

    const updated = await tx.fxConversion.update({
      where: { id: locked.id },
      data: {
        status: FxConversionStatus.POSTED,
        postedAt: now,
        postedById: actorUserId,
      },
      include: detailInclude,
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.FX_CONVERSION_POSTED,
      entityType: AUDIT_ENTITY_TYPES.FX_CONVERSION,
      entityId: updated.id,
      before: { status: locked.status },
      after: { status: updated.status, postedAt: now.toISOString() },
    });

    return updated;
  }

  private async parseAndValidateCreate(
    tx: Tx,
    companyId: string,
    dto: CreateFxConversionDto,
  ) {
    let appliedRate: Prisma.Decimal;
    try {
      appliedRate = parseFxRate(dto.appliedRate);
    } catch {
      throw new AppError({
        code: ERROR_CODES.FX_RATE_INVALID,
        message: FX_RATE_ERROR_MESSAGES.INVALID_RATE,
        statusCode: 400,
      });
    }
    if (appliedRate.lte(0)) {
      throw new AppError({
        code: ERROR_CODES.FX_RATE_ZERO,
        message: FX_RATE_ERROR_MESSAGES.ZERO_RATE,
        statusCode: 400,
      });
    }

    let fromAmount: Prisma.Decimal;
    let toAmount: Prisma.Decimal;
    try {
      fromAmount = parseMoneyAmount(dto.fromAmount, dto.fromCurrency);
      toAmount = parseMoneyAmount(dto.toAmount, dto.toCurrency);
    } catch {
      throw AppError.validation('Invalid conversion amounts for currencies.');
    }

    let expected;
    try {
      expected = previewConvertAmount({
        fromAmount,
        fromCurrency: dto.fromCurrency,
        toCurrency: dto.toCurrency,
        rateBaseCurrency: dto.rateBaseCurrency,
        rateQuoteCurrency: dto.rateQuoteCurrency,
        appliedRate,
      });
    } catch {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_RATE_PAIR_MISMATCH,
        message: FX_CONVERSION_ERROR_MESSAGES.RATE_PAIR_MISMATCH,
        statusCode: 400,
      });
    }
    if (!amountsMatchWithinRounding(expected.amount, toAmount)) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_ARITHMETIC_MISMATCH,
        message: FX_CONVERSION_ERROR_MESSAGES.ARITHMETIC_MISMATCH,
        statusCode: 400,
      });
    }

    const accounts = await tx.financialAccount.findMany({
      where: {
        companyId,
        id: {
          in: [
            dto.sourceAccountId,
            dto.destinationAccountId,
            ...(dto.feeAccountId ? [dto.feeAccountId] : []),
          ],
        },
      },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const source = byId.get(dto.sourceAccountId);
    const destination = byId.get(dto.destinationAccountId);
    if (!source || !destination) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND,
        message: 'Financial account not found.',
        statusCode: 404,
      });
    }
    if (
      source.status !== FinancialAccountStatus.ACTIVE ||
      destination.status !== FinancialAccountStatus.ACTIVE
    ) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_ACCOUNT_INACTIVE,
        message: FX_CONVERSION_ERROR_MESSAGES.ACCOUNT_INACTIVE,
        statusCode: 409,
      });
    }
    if (source.currency !== dto.fromCurrency || destination.currency !== dto.toCurrency) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_ACCOUNT_CURRENCY_MISMATCH,
        message: FX_CONVERSION_ERROR_MESSAGES.ACCOUNT_CURRENCY_MISMATCH,
        statusCode: 409,
      });
    }

    let feeAmount: Prisma.Decimal | null = null;
    let feeCurrency: CurrencyCode | null = null;
    let feeAccountId: string | null = null;
    const hasFee =
      dto.feeAmount != null || dto.feeCurrency != null || dto.feeAccountId != null;
    if (hasFee) {
      if (!dto.feeAmount || !dto.feeCurrency || !dto.feeAccountId) {
        throw new AppError({
          code: ERROR_CODES.FX_CONVERSION_FEE_INCOMPLETE,
          message: FX_CONVERSION_ERROR_MESSAGES.FEE_INCOMPLETE,
          statusCode: 400,
        });
      }
      try {
        feeAmount = parseMoneyAmount(dto.feeAmount, dto.feeCurrency);
      } catch {
        throw AppError.validation('Invalid feeAmount for feeCurrency.');
      }
      const feeAccount = byId.get(dto.feeAccountId);
      if (!feeAccount) {
        throw new AppError({
          code: ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND,
          message: 'Fee financial account not found.',
          statusCode: 404,
        });
      }
      if (feeAccount.status !== FinancialAccountStatus.ACTIVE) {
        throw new AppError({
          code: ERROR_CODES.FX_CONVERSION_ACCOUNT_INACTIVE,
          message: FX_CONVERSION_ERROR_MESSAGES.ACCOUNT_INACTIVE,
          statusCode: 409,
        });
      }
      if (feeAccount.currency !== dto.feeCurrency) {
        throw new AppError({
          code: ERROR_CODES.FX_CONVERSION_FEE_CURRENCY_MISMATCH,
          message: FX_CONVERSION_ERROR_MESSAGES.FEE_CURRENCY_MISMATCH,
          statusCode: 409,
        });
      }
      feeCurrency = dto.feeCurrency;
      feeAccountId = dto.feeAccountId;
    }

    let fxRateId: string | null = null;
    if (dto.fxRateId) {
      const rate = await tx.fxRate.findFirst({
        where: { id: dto.fxRateId, companyId, archivedAt: null },
      });
      if (!rate) {
        throw new AppError({
          code: ERROR_CODES.FX_RATE_NOT_FOUND,
          message: FX_RATE_ERROR_MESSAGES.NOT_FOUND,
          statusCode: 404,
        });
      }
      fxRateId = rate.id;
    }

    return {
      source,
      destination,
      fromAmount,
      fromCurrency: dto.fromCurrency,
      toAmount,
      toCurrency: dto.toCurrency,
      appliedRate,
      rateBaseCurrency: dto.rateBaseCurrency,
      rateQuoteCurrency: dto.rateQuoteCurrency,
      fxRateId,
      feeAmount,
      feeCurrency,
      feeAccountId,
    };
  }

  private assertIdempotentPayload(existing: DetailRow, dto: CreateFxConversionDto): void {
    const same =
      existing.sourceAccountId === dto.sourceAccountId &&
      existing.destinationAccountId === dto.destinationAccountId &&
      existing.fromAmount.toFixed() === dto.fromAmount.trim() &&
      existing.fromCurrency === dto.fromCurrency &&
      existing.toAmount.toFixed() === dto.toAmount.trim() &&
      existing.toCurrency === dto.toCurrency &&
      existing.appliedRate.toFixed() === dto.appliedRate.trim();
    if (!same) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_IDEMPOTENCY_CONFLICT,
        message: FX_CONVERSION_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private async lockConversion(tx: Tx, companyId: string, conversionId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM fx_conversions
      WHERE company_id = ${companyId}::uuid AND id = ${conversionId}::uuid
      FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_NOT_FOUND,
        message: FX_CONVERSION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return tx.fxConversion.findFirstOrThrow({
      where: { id: conversionId, companyId },
    });
  }

  private async loadDetailInTx(tx: Tx, companyId: string, conversionId: string) {
    return tx.fxConversion.findFirstOrThrow({
      where: { id: conversionId, companyId },
      include: detailInclude,
    });
  }

  private async requireDetail(companyId: string, conversionId: string): Promise<DetailRow> {
    const row = await this.database.client.fxConversion.findFirst({
      where: { id: conversionId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.FX_CONVERSION_NOT_FOUND,
        message: FX_CONVERSION_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private toView(row: DetailRow): FxConversionView {
    return {
      id: row.id,
      companyId: row.companyId,
      number: row.number,
      sourceAccountId: row.sourceAccountId,
      destinationAccountId: row.destinationAccountId,
      sourceAccount: row.sourceAccount,
      destinationAccount: row.destinationAccount,
      fromAmount: row.fromAmount.toFixed(),
      fromCurrency: row.fromCurrency,
      toAmount: row.toAmount.toFixed(),
      toCurrency: row.toCurrency,
      appliedRate: row.appliedRate.toFixed(),
      rateDisplay: describeFxQuote({
        baseCurrency: row.rateBaseCurrency,
        quoteCurrency: row.rateQuoteCurrency,
        rate: row.appliedRate,
      }),
      rateBaseCurrency: row.rateBaseCurrency,
      rateQuoteCurrency: row.rateQuoteCurrency,
      rateType: row.rateType,
      fxRateId: row.fxRateId,
      feeAmount: row.feeAmount?.toFixed() ?? null,
      feeCurrency: row.feeCurrency,
      feeAccountId: row.feeAccountId,
      status: row.status,
      effectiveAt: row.effectiveAt.toISOString(),
      notes: row.notes,
      requestId: row.requestId,
      createdById: row.createdById,
      postedAt: row.postedAt?.toISOString() ?? null,
      postedById: row.postedById,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelledById: row.cancelledById,
      reversedAt: row.reversedAt?.toISOString() ?? null,
      reversedById: row.reversedById,
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

// Ensure FX_CONVERSION is part of the provenance vocabulary used by the writer.
void FINANCE_ACCOUNT_SOURCE_TYPES.FX_CONVERSION;
