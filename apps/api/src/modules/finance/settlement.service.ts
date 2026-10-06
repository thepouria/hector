import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  ExpensePaymentAllocationStatus,
  FxRateType,
  PaymentStatus,
  Prisma,
  SupplierLiabilityMovementDirection,
  SupplierLiabilityMovementType,
  SupplierPayableStatus,
  SupplierPaymentAllocationStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { getRequestContext } from '../../common/context/request-context';
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
import { SETTLEMENT_ERROR_MESSAGES, SETTLEMENT_PAYMENT_SOURCE_TYPE } from './finance-settlements.constants';
import { SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES } from './finance-supplier-payables.constants';
import {
  JOURNAL_EFFECT_TYPES,
  JOURNAL_SOURCE_TYPES,
} from './finance-journals.constants';
import { postSupplierPayableSettlementJournalInTx } from './journal-builders';
import { JournalPostingService } from './journal-posting.service';
import { LedgerAccountsService } from './ledger-accounts.service';
import { convertMoney, type FxRateQuote } from './money/fx-rate';
import { moneyOf, parseMoneyAmount } from './money/money';
import {
  allocateCarryingBase,
  buildExplicitSettlementQuote,
  computeFxDifferenceBase,
  toBaseAmount,
} from './settlement-fx';
import {
  derivePayableStatus,
  derivePayableTotalsFromMovements,
} from './supplier-payable-outstanding';
import type {
  PreviewSettlementDto,
  SettlePayableDto,
  SettlePaymentDto,
  SettlementLineDto,
} from './dto/settlement.dto';
import type {
  SettlementAllocationView,
  SettlementBatchView,
  SettlementPreviewView,
} from './types/finance-settlement.types';

type Tx = Prisma.TransactionClient;

type PreparedLine = {
  payableId: string;
  payableNumber: string;
  liabilityCurrency: CurrencyCode;
  liabilityAmount: Prisma.Decimal;
  paymentCurrency: CurrencyCode;
  paymentAmount: Prisma.Decimal;
  outstandingBefore: Prisma.Decimal;
  recognized: Prisma.Decimal;
  referenceFxRate: Prisma.Decimal | null;
  referenceFxBaseCurrency: CurrencyCode | null;
  referenceFxQuoteCurrency: CurrencyCode | null;
  settlementRate: Prisma.Decimal | null;
  settlementRateBaseCurrency: CurrencyCode | null;
  settlementRateQuoteCurrency: CurrencyCode | null;
  settlementFxRateId: string | null;
  settlementQuote: FxRateQuote | null;
  carryingQuote: FxRateQuote | null;
};

@Injectable()
export class SettlementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly journalPosting: JournalPostingService,
    private readonly ledgerAccounts: LedgerAccountsService,
  ) {}

  async listForPayment(
    company: CompanyContext,
    paymentId: string,
  ): Promise<{ data: SettlementAllocationView[] }> {
    const payment = await this.database.client.payment.findFirst({
      where: { id: paymentId, companyId: company.companyId },
      select: { id: true },
    });
    if (!payment) {
      throw new AppError({
        code: ERROR_CODES.PAYMENT_NOT_FOUND,
        message: 'Payment not found.',
        statusCode: 404,
      });
    }
    const rows = await this.database.client.supplierPaymentAllocation.findMany({
      where: { companyId: company.companyId, paymentId },
      include: {
        payable: { select: { number: true } },
        payment: { select: { number: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { data: rows.map((r) => this.toView(r)) };
  }

  async get(
    company: CompanyContext,
    allocationId: string,
  ): Promise<SettlementAllocationView> {
    const row = await this.database.client.supplierPaymentAllocation.findFirst({
      where: { id: allocationId, companyId: company.companyId },
      include: {
        payable: { select: { number: true } },
        payment: { select: { number: true } },
      },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return this.toView(row);
  }

  async preview(
    company: CompanyContext,
    dto: PreviewSettlementDto,
  ): Promise<SettlementPreviewView> {
    return this.database.client.$transaction(async (tx) => {
      const prepared = await this.prepareSettlementInTx(tx, {
        companyId: company.companyId,
        paymentId: dto.paymentId,
        lines: dto.lines,
        actorUserId: this.requireActorUserId(),
        dryRun: true,
      });
      return prepared.preview;
    });
  }

  async settleFromPayment(
    company: CompanyContext,
    paymentId: string,
    dto: SettlePaymentDto,
  ): Promise<SettlementBatchView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      if (dto.requestId) {
        const existing = await this.findByRequestId(
          company.companyId,
          dto.requestId,
        );
        if (existing.length > 0) {
          if (existing.some((e) => e.paymentId !== paymentId)) {
            throw new AppError({
              code: ERROR_CODES.SETTLEMENT_IDEMPOTENCY_CONFLICT,
              message: SETTLEMENT_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
              statusCode: 409,
            });
          }
          return {
            settlementGroupId: existing[0]!.settlementGroupId ?? existing[0]!.id,
            paymentId,
            allocations: existing,
          };
        }
      }

      const result = await this.database.client.$transaction(async (tx) => {
        return this.settleInTx(tx, {
          companyId: company.companyId,
          paymentId,
          lines: dto.lines,
          requestId: dto.requestId ?? null,
          effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : null,
          actorUserId,
        });
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SUPPLIER_PAYABLE_SETTLEMENT_POSTED,
          payload: {
            companyId: company.companyId,
            paymentId,
            settlementGroupId: result.settlementGroupId,
            allocationIds: result.allocations.map((a) => a.id),
          },
        }),
      );
      for (const alloc of result.allocations) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SUPPLIER_PAYABLE_SETTLED,
            payload: {
              companyId: company.companyId,
              payableId: alloc.payableId,
              allocationId: alloc.id,
              paymentId,
            },
          }),
        );
      }
      return result;
    });
  }

  async settlePayable(
    company: CompanyContext,
    payableId: string,
    dto: SettlePayableDto,
  ): Promise<SettlementBatchView> {
    return this.settleFromPayment(company, dto.paymentId, {
      lines: [
        {
          payableId,
          liabilityAmount: dto.liabilityAmount,
          paymentAmount: dto.paymentAmount,
          settlementFxRateId: dto.settlementFxRateId,
          settlementRate: dto.settlementRate,
          settlementRateBaseCurrency: dto.settlementRateBaseCurrency,
          settlementRateQuoteCurrency: dto.settlementRateQuoteCurrency,
        },
      ],
      requestId: dto.requestId,
      effectiveAt: dto.effectiveAt,
    });
  }

  async reverseAllocation(
    company: CompanyContext,
    allocationId: string,
  ): Promise<SettlementAllocationView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        await this.reverseAllocationInTx(tx, {
          companyId: company.companyId,
          allocationId,
          actorUserId,
        });
        return this.loadViewInTx(tx, company.companyId, allocationId);
      });
      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.SUPPLIER_PAYABLE_SETTLEMENT_REVERSED,
          payload: {
            companyId: company.companyId,
            allocationId,
            paymentId: result.paymentId,
            payableId: result.payableId,
          },
        }),
      );
      return result;
    });
  }

  /**
   * Reverse all POSTED supplier settlements for a payment (FIN-SET-010).
   * Call inside Payment reverse TX before reversing payment clearing journal.
   */
  async reverseForPaymentInTx(
    tx: Tx,
    args: {
      companyId: string;
      paymentId: string;
      actorUserId: string;
      now?: Date;
    },
  ): Promise<void> {
    const allocs = await tx.supplierPaymentAllocation.findMany({
      where: {
        companyId: args.companyId,
        paymentId: args.paymentId,
        status: SupplierPaymentAllocationStatus.POSTED,
      },
      select: { id: true },
      orderBy: { payableId: 'asc' },
    });
    for (const alloc of allocs) {
      await this.reverseAllocationInTx(tx, {
        companyId: args.companyId,
        allocationId: alloc.id,
        actorUserId: args.actorUserId,
        now: args.now,
      });
    }
  }

  private async settleInTx(
    tx: Tx,
    input: {
      companyId: string;
      paymentId: string;
      lines: SettlementLineDto[];
      requestId: string | null;
      effectiveAt: Date | null;
      actorUserId: string;
    },
  ): Promise<SettlementBatchView> {
    const prepared = await this.prepareSettlementInTx(tx, {
      companyId: input.companyId,
      paymentId: input.paymentId,
      lines: input.lines,
      actorUserId: input.actorUserId,
      dryRun: false,
    });
    const payment = prepared.payment;
    const effectiveAt = input.effectiveAt ?? payment.effectiveAt;
    const settlementGroupId = randomUUID();
    const company = await tx.company.findFirstOrThrow({
      where: { id: input.companyId },
      select: { baseCurrency: true },
    });
    const baseCurrency = company.baseCurrency;
    const allocations: SettlementAllocationView[] = [];

    for (const line of prepared.lines) {
      const priorCarrying = await this.sumPostedCarryingBase(
        tx,
        input.companyId,
        line.payableId,
      );
      const totalCarrying = toBaseAmount({
        amount: line.recognized,
        currency: line.liabilityCurrency,
        baseCurrency,
        quote: line.carryingQuote,
      });
      const baseCarrying = allocateCarryingBase({
        liabilitySettled: line.liabilityAmount,
        outstandingBefore: line.outstandingBefore,
        totalCarryingBase: totalCarrying,
        priorCarryingSettled: priorCarrying,
        baseCurrency,
      });
      const basePayment = toBaseAmount({
        amount: line.paymentAmount,
        currency: line.paymentCurrency,
        baseCurrency,
        quote: line.settlementQuote,
      });
      const fxDifferenceBase = computeFxDifferenceBase(basePayment, baseCarrying);

      const allocation = await tx.supplierPaymentAllocation.create({
        data: {
          companyId: input.companyId,
          payableId: line.payableId,
          amount: line.liabilityAmount,
          currency: line.liabilityCurrency,
          paymentId: payment.id,
          paymentSourceType: SETTLEMENT_PAYMENT_SOURCE_TYPE,
          paymentSourceId: payment.id,
          paymentCurrency: line.paymentCurrency,
          paymentAmountApplied: line.paymentAmount,
          liabilityAmountSettled: line.liabilityAmount,
          settlementRate: line.settlementRate,
          settlementRateBaseCurrency: line.settlementRateBaseCurrency,
          settlementRateQuoteCurrency: line.settlementRateQuoteCurrency,
          settlementFxRateId: line.settlementFxRateId,
          baseCarryingAmount: baseCarrying,
          basePaymentAmount: basePayment,
          fxDifferenceBase,
          settlementGroupId,
          requestId: input.requestId,
          status: SupplierPaymentAllocationStatus.POSTED,
          effectiveAt,
          createdById: input.actorUserId,
        },
        include: {
          payable: { select: { number: true } },
          payment: { select: { number: true } },
        },
      });

      await tx.supplierLiabilityMovement.create({
        data: {
          companyId: input.companyId,
          payableId: line.payableId,
          supplierId: (
            await tx.supplierPayable.findFirstOrThrow({
              where: { id: line.payableId, companyId: input.companyId },
              select: { supplierId: true },
            })
          ).supplierId,
          direction: SupplierLiabilityMovementDirection.DECREASE,
          type: SupplierLiabilityMovementType.PAYMENT_ALLOCATION,
          amount: line.liabilityAmount,
          currency: line.liabilityCurrency,
          sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SUPPLIER_PAYMENT_ALLOCATION,
          sourceId: allocation.id,
          effectiveAt,
          // Movement requestId is unique per company — keep null for multi-line batches;
          // idempotency lives on SupplierPaymentAllocation.requestId.
          requestId: null,
          createdById: input.actorUserId,
        },
      });

      const nextOutstanding = line.outstandingBefore.minus(line.liabilityAmount);
      const nextStatus = derivePayableStatus({
        recognized: line.recognized,
        outstanding: nextOutstanding,
        currentStatus: SupplierPayableStatus.OPEN,
      });
      await tx.supplierPayable.update({
        where: { id: line.payableId },
        data: { status: nextStatus },
      });

      await postSupplierPayableSettlementJournalInTx(
        tx,
        { journals: this.journalPosting, ledger: this.ledgerAccounts },
        {
          companyId: input.companyId,
          actorUserId: input.actorUserId,
          allocationId: allocation.id,
          payableNumber: line.payableNumber,
          liabilityAmount: line.liabilityAmount,
          liabilityCurrency: line.liabilityCurrency,
          paymentAmount: line.paymentAmount,
          paymentCurrency: line.paymentCurrency,
          baseCarryingAmount: baseCarrying,
          basePaymentAmount: basePayment,
          fxDifferenceBase,
          settlementRate: line.settlementRate,
          settlementRateBaseCurrency: line.settlementRateBaseCurrency,
          settlementRateQuoteCurrency: line.settlementRateQuoteCurrency,
          effectiveAt,
        },
      );

      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.SUPPLIER_PAYABLE_SETTLEMENT_POSTED,
        entityType: AUDIT_ENTITY_TYPES.SUPPLIER_PAYMENT_ALLOCATION,
        entityId: allocation.id,
        after: {
          payableId: line.payableId,
          paymentId: payment.id,
          liabilityAmount: line.liabilityAmount.toString(),
          paymentAmount: line.paymentAmount.toString(),
          fxDifferenceBase: fxDifferenceBase.toString(),
          status: nextStatus,
        },
        context: {
          companyId: input.companyId,
          actorUserId: input.actorUserId,
        },
      });

      allocations.push(this.toView(allocation));
    }

    return {
      settlementGroupId,
      paymentId: payment.id,
      allocations,
    };
  }

  private async prepareSettlementInTx(
    tx: Tx,
    input: {
      companyId: string;
      paymentId: string;
      lines: SettlementLineDto[];
      actorUserId: string;
      dryRun: boolean;
    },
  ): Promise<{
    payment: {
      id: string;
      number: string;
      amount: Prisma.Decimal;
      currency: CurrencyCode;
      status: PaymentStatus;
      effectiveAt: Date;
    };
    lines: PreparedLine[];
    preview: SettlementPreviewView;
  }> {
    if (!input.lines.length) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_EMPTY_LINES,
        message: SETTLEMENT_ERROR_MESSAGES.EMPTY_LINES,
        statusCode: 400,
      });
    }

    await this.lockPayment(tx, input.companyId, input.paymentId);
    const payment = await tx.payment.findFirst({
      where: { id: input.paymentId, companyId: input.companyId },
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
        code: ERROR_CODES.SETTLEMENT_PAYMENT_NOT_POSTED,
        message: SETTLEMENT_ERROR_MESSAGES.PAYMENT_NOT_POSTED,
        statusCode: 409,
      });
    }

    const company = await tx.company.findFirstOrThrow({
      where: { id: input.companyId },
      select: { baseCurrency: true },
    });
    const baseCurrency = company.baseCurrency;

    const payableIds = [...new Set(input.lines.map((l) => l.payableId))].sort();
    for (const payableId of payableIds) {
      await this.lockPayable(tx, input.companyId, payableId);
    }

    const allocatedPayment = await this.sumPaymentAllocated(tx, input.companyId, payment.id);
    let remainingPayment = payment.amount.minus(allocatedPayment);
    if (remainingPayment.lt(0)) remainingPayment = new Prisma.Decimal(0);

    const prepared: PreparedLine[] = [];
    const previewLines: SettlementPreviewView['lines'] = [];
    let runningPaymentRemaining = remainingPayment;

    // Track in-batch liability consumption per payable
    const batchLiability = new Map<string, Prisma.Decimal>();

    for (const raw of input.lines) {
      const payable = await tx.supplierPayable.findFirst({
        where: { id: raw.payableId, companyId: input.companyId },
        include: {
          movements: { select: { direction: true, amount: true, type: true } },
        },
      });
      if (!payable) {
        throw new AppError({
          code: ERROR_CODES.SUPPLIER_PAYABLE_NOT_FOUND,
          message: 'Supplier payable not found.',
          statusCode: 404,
        });
      }
      if (payable.status === SupplierPayableStatus.CANCELLED) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_PAYABLE_CANCELLED,
          message: SETTLEMENT_ERROR_MESSAGES.PAYABLE_CANCELLED,
          statusCode: 409,
        });
      }

      const totals = derivePayableTotalsFromMovements(payable.movements);
      const consumedInBatch = batchLiability.get(payable.id) ?? new Prisma.Decimal(0);
      const outstandingBefore = totals.outstanding.minus(consumedInBatch);

      let liabilityAmount: Prisma.Decimal;
      try {
        liabilityAmount = parseMoneyAmount(raw.liabilityAmount, payable.currency);
      } catch {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_INVALID_MONEY,
          message: SETTLEMENT_ERROR_MESSAGES.INVALID_MONEY,
          statusCode: 400,
        });
      }
      if (liabilityAmount.gt(outstandingBefore)) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_OVER_LIABILITY,
          message: SETTLEMENT_ERROR_MESSAGES.OVER_LIABILITY,
          statusCode: 409,
        });
      }

      const sameCurrency = payable.currency === payment.currency;
      const rateResolved = await this.resolveSettlementRate(tx, {
        companyId: input.companyId,
        sameCurrency,
        liabilityCurrency: payable.currency,
        paymentCurrency: payment.currency,
        line: raw,
      });

      let paymentAmount: Prisma.Decimal;
      if (raw.paymentAmount) {
        try {
          paymentAmount = parseMoneyAmount(raw.paymentAmount, payment.currency);
        } catch {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_INVALID_MONEY,
            message: SETTLEMENT_ERROR_MESSAGES.INVALID_MONEY,
            statusCode: 400,
          });
        }
      } else if (sameCurrency) {
        paymentAmount = liabilityAmount;
      } else if (rateResolved.quote) {
        paymentAmount = convertMoney({
          money: moneyOf(liabilityAmount, payable.currency),
          toCurrency: payment.currency,
          quote: rateResolved.quote,
        }).amount;
      } else {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_CROSS_CURRENCY_INVALID,
          message: SETTLEMENT_ERROR_MESSAGES.CROSS_CURRENCY_INVALID,
          statusCode: 400,
        });
      }

      if (paymentAmount.gt(runningPaymentRemaining)) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_PAYMENT_OVER_ALLOCATED,
          message: SETTLEMENT_ERROR_MESSAGES.PAYMENT_OVER_ALLOCATED,
          statusCode: 409,
        });
      }

      const carryingQuote = this.referenceCarryingQuote(payable, baseCurrency);
      const priorCarrying = await this.sumPostedCarryingBase(
        tx,
        input.companyId,
        payable.id,
      );
      // Adjust prior carrying for in-batch lines of same payable (preview path)
      const baseCarrying = allocateCarryingBase({
        liabilitySettled: liabilityAmount,
        outstandingBefore,
        totalCarryingBase: toBaseAmount({
          amount: totals.recognized,
          currency: payable.currency,
          baseCurrency,
          quote: carryingQuote,
        }),
        priorCarryingSettled: priorCarrying.plus(
          // prior in-batch carrying already reflected via outstandingBefore reduction;
          // carrying remainder uses DB prior only + proportional — OK for dry-run estimate
          new Prisma.Decimal(0),
        ),
        baseCurrency,
      });
      const basePayment = toBaseAmount({
        amount: paymentAmount,
        currency: payment.currency,
        baseCurrency,
        quote: rateResolved.quote,
      });
      const fxDifferenceBase = computeFxDifferenceBase(basePayment, baseCarrying);

      prepared.push({
        payableId: payable.id,
        payableNumber: payable.number,
        liabilityCurrency: payable.currency,
        liabilityAmount,
        paymentCurrency: payment.currency,
        paymentAmount,
        outstandingBefore,
        recognized: totals.recognized,
        referenceFxRate: payable.referenceFxRate,
        referenceFxBaseCurrency: payable.referenceFxBaseCurrency,
        referenceFxQuoteCurrency: payable.referenceFxQuoteCurrency,
        settlementRate: rateResolved.rate,
        settlementRateBaseCurrency: rateResolved.baseCurrency,
        settlementRateQuoteCurrency: rateResolved.quoteCurrency,
        settlementFxRateId: rateResolved.fxRateId,
        settlementQuote: rateResolved.quote,
        carryingQuote,
      });

      previewLines.push({
        payableId: payable.id,
        payableNumber: payable.number,
        liabilityCurrency: payable.currency,
        liabilityAmount: liabilityAmount.toString(),
        paymentCurrency: payment.currency,
        paymentAmount: paymentAmount.toString(),
        outstandingBefore: outstandingBefore.toString(),
        outstandingAfter: outstandingBefore.minus(liabilityAmount).toString(),
        baseCarryingAmount: baseCarrying.toString(),
        basePaymentAmount: basePayment.toString(),
        fxDifferenceBase: fxDifferenceBase.toString(),
        settlementRate: rateResolved.rate?.toString() ?? null,
      });

      batchLiability.set(payable.id, consumedInBatch.plus(liabilityAmount));
      runningPaymentRemaining = runningPaymentRemaining.minus(paymentAmount);
    }

    return {
      payment: {
        id: payment.id,
        number: payment.number,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        effectiveAt: payment.effectiveAt,
      },
      lines: prepared,
      preview: {
        paymentId: payment.id,
        paymentNumber: payment.number,
        paymentAmount: payment.amount.toString(),
        paymentCurrency: payment.currency,
        paymentRemainingBefore: remainingPayment.toString(),
        paymentRemainingAfter: runningPaymentRemaining.toString(),
        lines: previewLines,
      },
    };
  }

  private async reverseAllocationInTx(
    tx: Tx,
    args: {
      companyId: string;
      allocationId: string;
      actorUserId: string;
      now?: Date;
    },
  ): Promise<void> {
    const now = args.now ?? new Date();
    const allocation = await tx.supplierPaymentAllocation.findFirst({
      where: { id: args.allocationId, companyId: args.companyId },
    });
    if (!allocation) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_NOT_FOUND,
        message: SETTLEMENT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    if (allocation.status !== SupplierPaymentAllocationStatus.POSTED) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_NOT_REVERSIBLE,
        message: SETTLEMENT_ERROR_MESSAGES.NOT_REVERSIBLE,
        statusCode: 409,
      });
    }

    await this.lockPayable(tx, args.companyId, allocation.payableId);

    await tx.supplierPaymentAllocation.update({
      where: { id: allocation.id },
      data: {
        status: SupplierPaymentAllocationStatus.REVERSED,
        reversedAt: now,
        reversedById: args.actorUserId,
      },
    });

    const payable = await tx.supplierPayable.findFirstOrThrow({
      where: { id: allocation.payableId, companyId: args.companyId },
      select: { supplierId: true },
    });

    await tx.supplierLiabilityMovement.create({
      data: {
        companyId: args.companyId,
        payableId: allocation.payableId,
        supplierId: payable.supplierId,
        direction: SupplierLiabilityMovementDirection.INCREASE,
        type: SupplierLiabilityMovementType.REVERSAL,
        amount: allocation.liabilityAmountSettled,
        currency: allocation.currency,
        sourceType: SUPPLIER_PAYABLE_LIABILITY_SOURCE_TYPES.SUPPLIER_PAYMENT_ALLOCATION,
        sourceId: allocation.id,
        effectiveAt: now,
        createdById: args.actorUserId,
        notes: 'Settlement reversal',
      },
    });

    const refreshed = await tx.supplierPayable.findFirstOrThrow({
      where: { id: allocation.payableId, companyId: args.companyId },
      include: {
        movements: { select: { direction: true, amount: true, type: true } },
      },
    });
    const totals = derivePayableTotalsFromMovements(refreshed.movements);
    const status = derivePayableStatus({
      recognized: totals.recognized,
      outstanding: totals.outstanding,
      currentStatus: refreshed.status,
    });
    await tx.supplierPayable.update({
      where: { id: refreshed.id },
      data: { status },
    });

    await this.journalPosting.reverseBySourceInTx(tx, {
      companyId: args.companyId,
      actorUserId: args.actorUserId,
      sourceType: JOURNAL_SOURCE_TYPES.SUPPLIER_PAYMENT_ALLOCATION,
      sourceId: allocation.id,
      effectType: JOURNAL_EFFECT_TYPES.SUPPLIER_AP_SETTLEMENT,
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.SUPPLIER_PAYABLE_SETTLEMENT_REVERSED,
      entityType: AUDIT_ENTITY_TYPES.SUPPLIER_PAYMENT_ALLOCATION,
      entityId: allocation.id,
      before: { status: SupplierPaymentAllocationStatus.POSTED },
      after: { status: SupplierPaymentAllocationStatus.REVERSED },
      context: {
        companyId: args.companyId,
        actorUserId: args.actorUserId,
      },
    });
  }

  private async resolveSettlementRate(
    tx: Tx,
    input: {
      companyId: string;
      sameCurrency: boolean;
      liabilityCurrency: CurrencyCode;
      paymentCurrency: CurrencyCode;
      line: SettlementLineDto;
    },
  ): Promise<{
    quote: FxRateQuote | null;
    rate: Prisma.Decimal | null;
    baseCurrency: CurrencyCode | null;
    quoteCurrency: CurrencyCode | null;
    fxRateId: string | null;
  }> {
    if (input.sameCurrency) {
      return {
        quote: null,
        rate: null,
        baseCurrency: null,
        quoteCurrency: null,
        fxRateId: null,
      };
    }

    if (input.line.settlementFxRateId) {
      const row = await tx.fxRate.findFirst({
        where: {
          id: input.line.settlementFxRateId,
          companyId: input.companyId,
          archivedAt: null,
        },
      });
      if (!row || row.rateType !== FxRateType.SETTLEMENT) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_FX_RATE_INVALID,
          message: SETTLEMENT_ERROR_MESSAGES.FX_RATE_INVALID,
          statusCode: 409,
        });
      }
      const quote = buildExplicitSettlementQuote({
        rate: row.rate,
        baseCurrency: row.baseCurrency,
        quoteCurrency: row.quoteCurrency,
      });
      this.assertQuoteCoversPair(quote, input.liabilityCurrency, input.paymentCurrency);
      return {
        quote,
        rate: row.rate,
        baseCurrency: row.baseCurrency,
        quoteCurrency: row.quoteCurrency,
        fxRateId: row.id,
      };
    }

    if (
      input.line.settlementRate &&
      input.line.settlementRateBaseCurrency &&
      input.line.settlementRateQuoteCurrency
    ) {
      try {
        const quote = buildExplicitSettlementQuote({
          rate: input.line.settlementRate,
          baseCurrency: input.line.settlementRateBaseCurrency,
          quoteCurrency: input.line.settlementRateQuoteCurrency,
        });
        this.assertQuoteCoversPair(quote, input.liabilityCurrency, input.paymentCurrency);
        return {
          quote,
          rate: quote.rate,
          baseCurrency: quote.baseCurrency,
          quoteCurrency: quote.quoteCurrency,
          fxRateId: null,
        };
      } catch {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_FX_RATE_INVALID,
          message: SETTLEMENT_ERROR_MESSAGES.FX_RATE_INVALID,
          statusCode: 400,
        });
      }
    }

    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_FX_RATE_REQUIRED,
      message: SETTLEMENT_ERROR_MESSAGES.FX_RATE_REQUIRED,
      statusCode: 409,
    });
  }

  private assertQuoteCoversPair(
    quote: FxRateQuote,
    a: CurrencyCode,
    b: CurrencyCode,
  ): void {
    const pair = new Set([quote.baseCurrency, quote.quoteCurrency]);
    if (!pair.has(a) || !pair.has(b)) {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_FX_RATE_INVALID,
        message: SETTLEMENT_ERROR_MESSAGES.FX_RATE_INVALID,
        statusCode: 409,
      });
    }
  }

  private referenceCarryingQuote(
    payable: {
      currency: CurrencyCode;
      referenceFxRate: Prisma.Decimal | null;
      referenceFxBaseCurrency: CurrencyCode | null;
      referenceFxQuoteCurrency: CurrencyCode | null;
    },
    baseCurrency: CurrencyCode,
  ): FxRateQuote | null {
    if (payable.currency === baseCurrency) return null;
    if (
      payable.referenceFxRate &&
      payable.referenceFxBaseCurrency &&
      payable.referenceFxQuoteCurrency
    ) {
      return buildExplicitSettlementQuote({
        rate: payable.referenceFxRate,
        baseCurrency: payable.referenceFxBaseCurrency,
        quoteCurrency: payable.referenceFxQuoteCurrency,
      });
    }
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_FX_RATE_REQUIRED,
      message: SETTLEMENT_ERROR_MESSAGES.FX_RATE_REQUIRED,
      statusCode: 409,
    });
  }

  private async sumPostedCarryingBase(
    tx: Tx,
    companyId: string,
    payableId: string,
  ): Promise<Prisma.Decimal> {
    const agg = await tx.supplierPaymentAllocation.aggregate({
      where: {
        companyId,
        payableId,
        status: SupplierPaymentAllocationStatus.POSTED,
      },
      _sum: { baseCarryingAmount: true },
    });
    return agg._sum.baseCarryingAmount ?? new Prisma.Decimal(0);
  }

  /** Sum payment-currency amounts already allocated (supplier POSTED + expense ACTIVE). */
  private async sumPaymentAllocated(
    tx: Tx,
    companyId: string,
    paymentId: string,
  ): Promise<Prisma.Decimal> {
    const supplierAgg = await tx.supplierPaymentAllocation.aggregate({
      where: {
        companyId,
        paymentId,
        status: SupplierPaymentAllocationStatus.POSTED,
      },
      _sum: { paymentAmountApplied: true },
    });
    const expenseAgg = await tx.expensePaymentAllocation.aggregate({
      where: {
        companyId,
        paymentId,
        status: ExpensePaymentAllocationStatus.ACTIVE,
      },
      _sum: { amount: true },
    });
    const a = supplierAgg._sum.paymentAmountApplied ?? new Prisma.Decimal(0);
    const b = expenseAgg._sum.amount ?? new Prisma.Decimal(0);
    return a.plus(b);
  }

  private async lockPayment(tx: Tx, companyId: string, paymentId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM payments
      WHERE id = ${paymentId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    if (!rows[0]) {
      throw new AppError({
        code: ERROR_CODES.PAYMENT_NOT_FOUND,
        message: 'Payment not found.',
        statusCode: 404,
      });
    }
  }

  private async lockPayable(tx: Tx, companyId: string, payableId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM supplier_payables
      WHERE id = ${payableId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    if (!rows[0]) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_PAYABLE_NOT_FOUND,
        message: 'Supplier payable not found.',
        statusCode: 404,
      });
    }
  }

  private async findByRequestId(
    companyId: string,
    requestId: string,
  ): Promise<SettlementAllocationView[]> {
    const rows = await this.database.client.supplierPaymentAllocation.findMany({
      where: { companyId, requestId },
      include: {
        payable: { select: { number: true } },
        payment: { select: { number: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toView(r));
  }

  private async loadViewInTx(
    tx: Tx,
    companyId: string,
    allocationId: string,
  ): Promise<SettlementAllocationView> {
    const row = await tx.supplierPaymentAllocation.findFirstOrThrow({
      where: { id: allocationId, companyId },
      include: {
        payable: { select: { number: true } },
        payment: { select: { number: true } },
      },
    });
    return this.toView(row);
  }

  private toView(row: {
    id: string;
    companyId: string;
    payableId: string;
    paymentId: string | null;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    paymentCurrency: CurrencyCode;
    paymentAmountApplied: Prisma.Decimal;
    liabilityAmountSettled: Prisma.Decimal;
    settlementRate: Prisma.Decimal | null;
    settlementRateBaseCurrency: CurrencyCode | null;
    settlementRateQuoteCurrency: CurrencyCode | null;
    settlementFxRateId: string | null;
    baseCarryingAmount: Prisma.Decimal | null;
    basePaymentAmount: Prisma.Decimal | null;
    fxDifferenceBase: Prisma.Decimal | null;
    settlementGroupId: string | null;
    requestId: string | null;
    status: SupplierPaymentAllocationStatus;
    effectiveAt: Date;
    createdAt: Date;
    reversedAt: Date | null;
    payable?: { number: string } | null;
    payment?: { number: string } | null;
  }): SettlementAllocationView {
    return {
      id: row.id,
      companyId: row.companyId,
      payableId: row.payableId,
      payableNumber: row.payable?.number ?? null,
      paymentId: row.paymentId,
      paymentNumber: row.payment?.number ?? null,
      amount: row.amount.toString(),
      currency: row.currency,
      paymentCurrency: row.paymentCurrency,
      paymentAmountApplied: row.paymentAmountApplied.toString(),
      liabilityAmountSettled: row.liabilityAmountSettled.toString(),
      settlementRate: row.settlementRate?.toString() ?? null,
      settlementRateBaseCurrency: row.settlementRateBaseCurrency,
      settlementRateQuoteCurrency: row.settlementRateQuoteCurrency,
      settlementFxRateId: row.settlementFxRateId,
      baseCarryingAmount: row.baseCarryingAmount?.toString() ?? null,
      basePaymentAmount: row.basePaymentAmount?.toString() ?? null,
      fxDifferenceBase: row.fxDifferenceBase?.toString() ?? null,
      settlementGroupId: row.settlementGroupId,
      requestId: row.requestId,
      status: row.status,
      effectiveAt: row.effectiveAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      reversedAt: row.reversedAt?.toISOString() ?? null,
    };
  }

  private requireActorUserId(): string {
    const ctx = getRequestContext();
    if (!ctx?.userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Unauthorized',
        statusCode: 401,
      });
    }
    return ctx.userId;
  }
}
