import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FxRateSourceType,
  Prisma,
  SettlementAllocationStatus,
  SettlementFinanceTxnType,
  SettlementManualObligationStatus,
  SettlementSourceType,
  SettlementStatus,
  SettlementType,
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
import { parseMoneyAmount } from '../finance/money/money';
import { resolveFinanceTransaction } from './adapters/finance-txn-adapter';
import { resolveSettleableSource } from './adapters/source-adapter';
import {
  applyDomainAllocationEffect,
  reverseDomainAllocationEffect,
} from './domain-effects';
import { resolveAllocationMoney } from './fx-settlement';
import { SETTLEMENT_ERROR_MESSAGES } from './settlement.constants';
import { allocateSettlementSequence, formatSettlementNumber } from './settlement-numbering';

function assertFinanceTxnDirection(
  sourceType: SettlementSourceType,
  financeTxnType: SettlementFinanceTxnType,
): void {
  const channelNeedsReceipt = sourceType === SettlementSourceType.CHANNEL;
  if (channelNeedsReceipt && financeTxnType !== SettlementFinanceTxnType.RECEIPT) {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_FINANCE_TXN_DIRECTION_INVALID,
      message: SETTLEMENT_ERROR_MESSAGES.FINANCE_TXN_DIRECTION_INVALID,
      statusCode: 409,
    });
  }
  if (
    !channelNeedsReceipt &&
    financeTxnType !== SettlementFinanceTxnType.PAYMENT
  ) {
    throw new AppError({
      code: ERROR_CODES.SETTLEMENT_FINANCE_TXN_DIRECTION_INVALID,
      message: SETTLEMENT_ERROR_MESSAGES.FINANCE_TXN_DIRECTION_INVALID,
      statusCode: 409,
    });
  }
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

type Tx = Prisma.TransactionClient;

export type SettlementView = {
  id: string;
  companyId: string;
  number: string;
  type: SettlementType;
  status: SettlementStatus;
  partyId: string | null;
  currency: CurrencyCode;
  settlementDate: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  items: SettlementItemView[];
  allocations: SettlementAllocationView[];
  totals: {
    originalAmount: string;
    allocatedAmount: string;
    remainingAmount: string;
  };
};

export type SettlementItemView = {
  id: string;
  settlementId: string;
  sourceType: SettlementSourceType;
  sourceId: string;
  currency: CurrencyCode;
  originalAmount: string;
  allocatedAmount: string;
  remainingAmount: string;
  derivedStatus: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED';
};

export type SettlementAllocationView = {
  id: string;
  settlementId: string;
  settlementItemId: string;
  financeTxnType: SettlementFinanceTxnType;
  financeTxnId: string;
  paymentId: string | null;
  amount: string;
  currency: CurrencyCode;
  paymentAmount: string;
  paymentCurrency: CurrencyCode;
  status: SettlementAllocationStatus;
  allocatedAt: string;
  reversedAt: string | null;
  reverseReason: string | null;
  fx: {
    rate: string;
    rateBaseCurrency: CurrencyCode;
    rateQuoteCurrency: CurrencyCode;
    rateDate: string;
    rateSourceType: string;
    roundingDifference: string;
  } | null;
};

@Injectable()
export class SettlementsCoreService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
  ) {}

  async get(company: CompanyContext, settlementId: string): Promise<SettlementView> {
    const row = await this.database.client.settlement.findFirst({
      where: { id: settlementId, companyId: company.companyId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        allocations: {
          orderBy: { createdAt: 'asc' },
          include: { fxDetail: true },
        },
      },
    });
    if (!row) throw this.notFound();
    return this.toSettlementView(row);
  }

  async create(
    company: CompanyContext,
    dto: {
      currency: CurrencyCode;
      type?: SettlementType;
      partyId?: string;
      settlementDate?: string;
      reference?: string;
      notes?: string;
      requestId?: string;
    },
  ): Promise<SettlementView> {
    const actorId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const id = await this.database.client.$transaction(async (tx) => {
        if (dto.requestId) {
          const existing = await tx.settlement.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
          });
          if (existing) return existing.id;
        }
        if (dto.partyId) {
          await this.requireParty(tx, company.companyId, dto.partyId);
        }
        const seq = await allocateSettlementSequence(tx, company.companyId);
        const number = formatSettlementNumber(seq);
        const row = await tx.settlement.create({
          data: {
            companyId: company.companyId,
            number,
            type: dto.type ?? SettlementType.GENERIC,
            status: SettlementStatus.DRAFT,
            partyId: dto.partyId ?? null,
            currency: dto.currency,
            settlementDate: dto.settlementDate ? new Date(dto.settlementDate) : null,
            reference: dto.reference?.trim() || null,
            notes: dto.notes?.trim() || null,
            requestId: dto.requestId ?? null,
            createdById: actorId,
          },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SETTLEMENT_CORE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SETTLEMENT,
          entityId: row.id,
          before: null,
          after: { number: row.number, status: row.status, currency: row.currency },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SETTLEMENT_CREATED,
            payload: {
              companyId: company.companyId,
              settlementId: row.id,
              settlementNumber: row.number,
            },
          }),
        );
        return row.id;
      }, TX_OPTIONS);
      return this.get(company, id);
    });
  }

  async createManualObligation(
    company: CompanyContext,
    dto: {
      currency: CurrencyCode;
      originalAmount: string;
      partyId?: string;
      notes?: string;
    },
  ) {
    const actorId = this.requireActorUserId();
    const amount = this.parseAmount(dto.originalAmount, dto.currency);
    if (dto.partyId) {
      await this.requireParty(this.database.client, company.companyId, dto.partyId);
    }
    const row = await this.database.client.settlementManualObligation.create({
      data: {
        companyId: company.companyId,
        currency: dto.currency,
        originalAmount: amount,
        partyId: dto.partyId ?? null,
        notes: dto.notes?.trim() || null,
        status: SettlementManualObligationStatus.ACTIVE,
        createdById: actorId,
      },
    });
    return {
      id: row.id,
      companyId: row.companyId,
      currency: row.currency,
      originalAmount: row.originalAmount.toString(),
      partyId: row.partyId,
      status: row.status,
    };
  }

  async addItem(
    company: CompanyContext,
    settlementId: string,
    dto: { sourceType: SettlementSourceType; sourceId: string },
  ): Promise<SettlementView> {
    await this.database.client.$transaction(async (tx) => {
      const settlement = await this.requireSettlement(tx, company.companyId, settlementId);
      if (settlement.status !== SettlementStatus.DRAFT) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_INVALID_STATUS,
          message: SETTLEMENT_ERROR_MESSAGES.DRAFT_ONLY,
          statusCode: 409,
        });
      }
      const source = await resolveSettleableSource(
        tx,
        company.companyId,
        dto.sourceType,
        dto.sourceId,
      );
      if (!source.settleable) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_SOURCE_UNSUPPORTED,
          message: SETTLEMENT_ERROR_MESSAGES.SOURCE_NOT_SETTLEABLE,
          statusCode: 409,
        });
      }
      if (source.currency !== settlement.currency) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_CURRENCY_MISMATCH,
          message: SETTLEMENT_ERROR_MESSAGES.CURRENCY_MISMATCH,
          statusCode: 409,
        });
      }
      if (settlement.partyId && source.partyId && settlement.partyId !== source.partyId) {
        throw new AppError({
          code: ERROR_CODES.SETTLEMENT_PARTY_CONFLICT,
          message: SETTLEMENT_ERROR_MESSAGES.PARTY_CONFLICT,
          statusCode: 409,
        });
      }
      const item = await tx.settlementItem.create({
        data: {
          companyId: company.companyId,
          settlementId,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          currency: source.currency,
          originalAmount: source.originalAmount,
        },
      });
      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.SETTLEMENT_CORE_ITEM_ADDED,
        entityType: AUDIT_ENTITY_TYPES.SETTLEMENT_ITEM,
        entityId: item.id,
        before: null,
        after: {
          settlementId,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          originalAmount: item.originalAmount.toString(),
          currency: item.currency,
        },
      });
    }, TX_OPTIONS);
    return this.get(company, settlementId);
  }

  async open(company: CompanyContext, settlementId: string): Promise<SettlementView> {
    return commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        const settlement = await this.requireSettlement(tx, company.companyId, settlementId);
        if (settlement.status !== SettlementStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_INVALID_STATUS,
            message: SETTLEMENT_ERROR_MESSAGES.OPENABLE_ONLY,
            statusCode: 409,
          });
        }
        const itemCount = await tx.settlementItem.count({
          where: { companyId: company.companyId, settlementId },
        });
        if (itemCount < 1) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_EMPTY_LINES,
            message: 'Settlement must have at least one item before opening.',
            statusCode: 409,
          });
        }
        await tx.settlement.update({
          where: { id: settlementId },
          data: { status: SettlementStatus.OPEN },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SETTLEMENT_CORE_OPENED,
          entityType: AUDIT_ENTITY_TYPES.SETTLEMENT,
          entityId: settlementId,
          before: { status: SettlementStatus.DRAFT },
          after: { status: SettlementStatus.OPEN },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SETTLEMENT_OPENED,
            payload: { companyId: company.companyId, settlementId },
          }),
        );
      }, TX_OPTIONS);
      return this.get(company, settlementId);
    });
  }

  /**
   * Canonical Allocation Engine.
   * Lock order: Payment → Source obligation → Settlement → SettlementItem.
   */
  async allocate(
    company: CompanyContext,
    settlementId: string,
    dto: {
      settlementItemId: string;
      financeTxnType: SettlementFinanceTxnType;
      financeTxnId: string;
      /** Obligation-currency amount to settle. */
      amount: string;
      /** Optional payment-currency amount (required consistency for FX). */
      paymentAmount?: string;
      fx?: {
        rate: string;
        rateBaseCurrency: CurrencyCode;
        rateQuoteCurrency: CurrencyCode;
        rateDate?: string;
        rateSourceType?: FxRateSourceType;
        fxRateId?: string;
      };
      requestId?: string;
    },
  ): Promise<SettlementView> {
    const actorId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        if (dto.requestId) {
          const existing = await tx.settlementAllocation.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: { fxDetail: true },
          });
          if (existing) {
            if (
              existing.settlementId !== settlementId ||
              existing.settlementItemId !== dto.settlementItemId ||
              existing.financeTxnId !== dto.financeTxnId ||
              existing.amount.toString() !==
                this.parseAmount(dto.amount, existing.currency).toString()
            ) {
              throw new AppError({
                code: ERROR_CODES.SETTLEMENT_IDEMPOTENCY_CONFLICT,
                message: SETTLEMENT_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
                statusCode: 409,
              });
            }
            return;
          }
        }

        // 1) Lock finance txn
        const finance = await resolveFinanceTransaction(
          tx,
          company.companyId,
          dto.financeTxnType,
          dto.financeTxnId,
          { lock: true },
        );
        if (!finance.allocatable) {
          throw new AppError({
            code:
              dto.financeTxnType === SettlementFinanceTxnType.RECEIPT
                ? ERROR_CODES.SETTLEMENT_RECEIPT_NOT_POSTED
                : ERROR_CODES.SETTLEMENT_PAYMENT_NOT_POSTED,
            message:
              dto.financeTxnType === SettlementFinanceTxnType.RECEIPT
                ? SETTLEMENT_ERROR_MESSAGES.RECEIPT_NOT_POSTED
                : SETTLEMENT_ERROR_MESSAGES.PAYMENT_NOT_POSTED,
            statusCode: 409,
          });
        }

        await this.lockSettlement(tx, company.companyId, settlementId);
        const settlement = await this.requireSettlement(tx, company.companyId, settlementId);
        if (
          settlement.status !== SettlementStatus.OPEN &&
          settlement.status !== SettlementStatus.PARTIALLY_SETTLED
        ) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_INVALID_STATUS,
            message: SETTLEMENT_ERROR_MESSAGES.NOT_ALLOCATABLE,
            statusCode: 409,
          });
        }

        await this.lockSettlementItem(tx, company.companyId, dto.settlementItemId);
        const item = await tx.settlementItem.findFirst({
          where: {
            id: dto.settlementItemId,
            companyId: company.companyId,
            settlementId,
          },
        });
        if (!item) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_ITEM_NOT_FOUND,
            message: SETTLEMENT_ERROR_MESSAGES.ITEM_NOT_FOUND,
            statusCode: 404,
          });
        }
        if (item.currency !== settlement.currency) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_CURRENCY_MISMATCH,
            message: SETTLEMENT_ERROR_MESSAGES.CURRENCY_MISMATCH,
            statusCode: 409,
          });
        }

        // 2) Lock + resolve authoritative source remaining
        const source = await resolveSettleableSource(
          tx,
          company.companyId,
          item.sourceType,
          item.sourceId,
          { lock: true },
        );
        if (!source.settleable) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_SOURCE_UNSUPPORTED,
            message: SETTLEMENT_ERROR_MESSAGES.SOURCE_NOT_SETTLEABLE,
            statusCode: 409,
          });
        }
        if (source.currency !== settlement.currency) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_CURRENCY_MISMATCH,
            message: SETTLEMENT_ERROR_MESSAGES.CURRENCY_MISMATCH,
            statusCode: 409,
          });
        }
        if (settlement.partyId && source.partyId && settlement.partyId !== source.partyId) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_PARTY_CONFLICT,
            message: SETTLEMENT_ERROR_MESSAGES.PARTY_CONFLICT,
            statusCode: 409,
          });
        }

        // Direction guard: CHANNEL consumes RECEIPT; payable/loan/manual consume PAYMENT.
        assertFinanceTxnDirection(item.sourceType, finance.financeTxnType);

        const money = resolveAllocationMoney({
          obligationCurrency: source.currency,
          paymentCurrency: finance.currency,
          obligationAmountRaw: dto.amount,
          paymentAmountRaw: dto.paymentAmount,
          fx: dto.fx,
        });

        // 3) Capacities under locks
        const financeFresh = await resolveFinanceTransaction(
          tx,
          company.companyId,
          dto.financeTxnType,
          dto.financeTxnId,
        );
        if (money.paymentAmount.gt(financeFresh.remaining)) {
          throw new AppError({
            code:
              finance.financeTxnType === SettlementFinanceTxnType.RECEIPT
                ? ERROR_CODES.SETTLEMENT_OVER_ALLOCATE_RECEIPT
                : ERROR_CODES.SETTLEMENT_OVER_ALLOCATE_PAYMENT,
            message:
              finance.financeTxnType === SettlementFinanceTxnType.RECEIPT
                ? SETTLEMENT_ERROR_MESSAGES.OVER_ALLOCATE_RECEIPT
                : SETTLEMENT_ERROR_MESSAGES.OVER_ALLOCATE_PAYMENT,
            statusCode: 409,
          });
        }

        const sourceFresh = await resolveSettleableSource(
          tx,
          company.companyId,
          item.sourceType,
          item.sourceId,
        );
        if (money.obligationAmount.gt(sourceFresh.remainingAmount)) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_OVER_SETTLE_OBLIGATION,
            message: SETTLEMENT_ERROR_MESSAGES.OVER_SETTLE_OBLIGATION,
            statusCode: 409,
          });
        }

        const isCrossCurrency = money.paymentCurrency !== money.obligationCurrency;
        const allocatedAt = new Date();

        const allocation = await tx.settlementAllocation.create({
          data: {
            companyId: company.companyId,
            settlementId,
            settlementItemId: item.id,
            financeTxnType: finance.financeTxnType,
            financeTxnId: finance.financeTxnId,
            paymentId: finance.paymentId,
            receiptId: finance.receiptId,
            amount: money.obligationAmount,
            currency: money.obligationCurrency,
            paymentAmount: money.paymentAmount,
            paymentCurrency: money.paymentCurrency,
            status: SettlementAllocationStatus.ACTIVE,
            requestId: dto.requestId ?? null,
            allocatedAt,
            createdById: actorId,
          },
        });

        if (isCrossCurrency) {
          await tx.settlementAllocationFxDetail.create({
            data: {
              companyId: company.companyId,
              allocationId: allocation.id,
              paymentCurrency: money.paymentCurrency,
              paymentAmount: money.paymentAmount,
              obligationCurrency: money.obligationCurrency,
              obligationAmount: money.obligationAmount,
              rate: money.rate,
              rateBaseCurrency: money.rateBaseCurrency,
              rateQuoteCurrency: money.rateQuoteCurrency,
              rateDate: money.rateDate,
              rateSourceType: money.rateSourceType,
              fxRateId: money.fxRateId,
              roundingDifference: money.roundingDifference,
            },
          });
        }

        await applyDomainAllocationEffect(tx, {
          companyId: company.companyId,
          actorUserId: actorId,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          allocationId: allocation.id,
          obligationAmount: money.obligationAmount,
          obligationCurrency: money.obligationCurrency,
          effectiveAt: allocatedAt,
        });

        const nextStatus = await this.deriveAndPersistStatus(tx, company.companyId, settlementId);

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SETTLEMENT_CORE_ALLOCATION_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SETTLEMENT_ALLOCATION,
          entityId: allocation.id,
          before: null,
          after: {
            settlementId,
            settlementItemId: item.id,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            financeTxnType: allocation.financeTxnType,
            financeTxnId: allocation.financeTxnId,
            obligationAmount: money.obligationAmount.toString(),
            obligationCurrency: money.obligationCurrency,
            paymentAmount: money.paymentAmount.toString(),
            paymentCurrency: money.paymentCurrency,
            fxRate: isCrossCurrency ? money.rate.toString() : null,
            status: nextStatus,
          },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SETTLEMENT_ALLOCATION_CREATED,
            payload: {
              companyId: company.companyId,
              settlementId,
              allocationId: allocation.id,
              amount: money.obligationAmount.toString(),
              currency: money.obligationCurrency,
              paymentAmount: money.paymentAmount.toString(),
              paymentCurrency: money.paymentCurrency,
              sourceType: item.sourceType,
              sourceId: item.sourceId,
            },
          }),
        );
        if (nextStatus === SettlementStatus.PARTIALLY_SETTLED) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.SETTLEMENT_PARTIALLY_SETTLED,
              payload: {
                companyId: company.companyId,
                settlementId,
                sourceType: item.sourceType,
                sourceId: item.sourceId,
              },
            }),
          );
        }
        if (nextStatus === SettlementStatus.SETTLED) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.SETTLEMENT_COMPLETED,
              payload: {
                companyId: company.companyId,
                settlementId,
                sourceType: item.sourceType,
                sourceId: item.sourceId,
              },
            }),
          );
        }
      }, TX_OPTIONS);
      return this.get(company, settlementId);
    });
  }

  async reverseAllocation(
    company: CompanyContext,
    settlementId: string,
    allocationId: string,
    dto: { reason?: string } = {},
  ): Promise<SettlementView> {
    const actorId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        await this.lockSettlement(tx, company.companyId, settlementId);
        const allocation = await tx.settlementAllocation.findFirst({
          where: { id: allocationId, companyId: company.companyId, settlementId },
          include: { settlementItem: true },
        });
        if (!allocation) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_ALLOCATION_NOT_FOUND,
            message: SETTLEMENT_ERROR_MESSAGES.ALLOCATION_NOT_FOUND,
            statusCode: 404,
          });
        }
        if (allocation.status === SettlementAllocationStatus.REVERSED) {
          return; // idempotent reverse
        }
        if (allocation.paymentId) {
          await resolveFinanceTransaction(
            tx,
            company.companyId,
            SettlementFinanceTxnType.PAYMENT,
            allocation.paymentId,
            { lock: true },
          );
        }
        await resolveSettleableSource(
          tx,
          company.companyId,
          allocation.settlementItem.sourceType,
          allocation.settlementItem.sourceId,
          { lock: true },
        );
        await tx.settlementAllocation.update({
          where: { id: allocationId },
          data: {
            status: SettlementAllocationStatus.REVERSED,
            reversedAt: new Date(),
            reversedById: actorId,
            reverseReason: dto.reason?.trim() || null,
          },
        });
        await reverseDomainAllocationEffect(tx, {
          companyId: company.companyId,
          actorUserId: actorId,
          sourceType: allocation.settlementItem.sourceType,
          sourceId: allocation.settlementItem.sourceId,
          allocationId,
          obligationAmount: allocation.amount,
          effectiveAt: new Date(),
        });
        const nextStatus = await this.deriveAndPersistStatus(tx, company.companyId, settlementId);
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SETTLEMENT_CORE_ALLOCATION_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.SETTLEMENT_ALLOCATION,
          entityId: allocationId,
          before: { status: SettlementAllocationStatus.ACTIVE },
          after: {
            status: SettlementAllocationStatus.REVERSED,
            reverseReason: dto.reason?.trim() || null,
            derivedSettlementStatus: nextStatus,
            obligationAmount: allocation.amount.toString(),
            obligationCurrency: allocation.currency,
          },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SETTLEMENT_ALLOCATION_REVERSED,
            payload: {
              companyId: company.companyId,
              settlementId,
              allocationId,
              sourceType: allocation.settlementItem.sourceType,
              sourceId: allocation.settlementItem.sourceId,
            },
          }),
        );
      }, TX_OPTIONS);
      return this.get(company, settlementId);
    });
  }

  async cancel(company: CompanyContext, settlementId: string): Promise<SettlementView> {
    const actorId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        await this.lockSettlement(tx, company.companyId, settlementId);
        const settlement = await this.requireSettlement(tx, company.companyId, settlementId);
        if (settlement.status === SettlementStatus.CANCELLED) {
          return;
        }
        const active = await tx.settlementAllocation.count({
          where: {
            companyId: company.companyId,
            settlementId,
            status: SettlementAllocationStatus.ACTIVE,
          },
        });
        if (active > 0) {
          throw new AppError({
            code: ERROR_CODES.SETTLEMENT_CANCEL_BLOCKED,
            message: SETTLEMENT_ERROR_MESSAGES.CANCEL_BLOCKED,
            statusCode: 409,
          });
        }
        await tx.settlement.update({
          where: { id: settlementId },
          data: {
            status: SettlementStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorId,
          },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SETTLEMENT_CORE_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.SETTLEMENT,
          entityId: settlementId,
          before: { status: settlement.status },
          after: { status: SettlementStatus.CANCELLED },
        });
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.SETTLEMENT_CANCELLED,
            payload: { companyId: company.companyId, settlementId },
          }),
        );
      }, TX_OPTIONS);
      return this.get(company, settlementId);
    });
  }

  private async deriveAndPersistStatus(
    tx: Tx,
    companyId: string,
    settlementId: string,
  ): Promise<SettlementStatus> {
    const settlement = await this.requireSettlement(tx, companyId, settlementId);
    if (
      settlement.status === SettlementStatus.DRAFT ||
      settlement.status === SettlementStatus.CANCELLED
    ) {
      return settlement.status;
    }
    const items = await tx.settlementItem.findMany({
      where: { companyId, settlementId },
    });
    let original = new Prisma.Decimal(0);
    let allocated = new Prisma.Decimal(0);
    for (const item of items) {
      original = original.plus(item.originalAmount);
      allocated = allocated.plus(await this.sumItemAllocated(tx, companyId, item.id));
    }
    const remaining = original.minus(allocated);
    let next: SettlementStatus;
    if (allocated.lte(0)) {
      next = SettlementStatus.OPEN;
    } else if (remaining.lte(0)) {
      next = SettlementStatus.SETTLED;
    } else {
      next = SettlementStatus.PARTIALLY_SETTLED;
    }
    if (next !== settlement.status) {
      await tx.settlement.update({
        where: { id: settlementId },
        data: { status: next },
      });
      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.SETTLEMENT_CORE_STATUS_DERIVED,
        entityType: AUDIT_ENTITY_TYPES.SETTLEMENT,
        entityId: settlementId,
        before: { status: settlement.status },
        after: {
          status: next,
          allocatedAmount: allocated.toString(),
          remainingAmount: remaining.toString(),
        },
      });
    }
    return next;
  }

  private async sumItemAllocated(
    tx: Tx,
    companyId: string,
    settlementItemId: string,
  ): Promise<Prisma.Decimal> {
    const agg = await tx.settlementAllocation.aggregate({
      where: {
        companyId,
        settlementItemId,
        status: SettlementAllocationStatus.ACTIVE,
      },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? new Prisma.Decimal(0);
  }

  private async toSettlementView(row: {
    id: string;
    companyId: string;
    number: string;
    type: SettlementType;
    status: SettlementStatus;
    partyId: string | null;
    currency: CurrencyCode;
    settlementDate: Date | null;
    reference: string | null;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    cancelledAt: Date | null;
    items: Array<{
      id: string;
      settlementId: string;
      sourceType: SettlementSourceType;
      sourceId: string;
      currency: CurrencyCode;
      originalAmount: Prisma.Decimal;
    }>;
    allocations: Array<{
      id: string;
      settlementId: string;
      settlementItemId: string;
      financeTxnType: SettlementFinanceTxnType;
      financeTxnId: string;
      paymentId: string | null;
      amount: Prisma.Decimal;
      currency: CurrencyCode;
      paymentAmount: Prisma.Decimal;
      paymentCurrency: CurrencyCode;
      status: SettlementAllocationStatus;
      allocatedAt: Date;
      reversedAt: Date | null;
      reverseReason: string | null;
      fxDetail: {
        rate: Prisma.Decimal;
        rateBaseCurrency: CurrencyCode;
        rateQuoteCurrency: CurrencyCode;
        rateDate: Date;
        rateSourceType: string;
        roundingDifference: Prisma.Decimal;
      } | null;
    }>;
  }): Promise<SettlementView> {
    const itemViews: SettlementItemView[] = [];
    let originalTotal = new Prisma.Decimal(0);
    let allocatedTotal = new Prisma.Decimal(0);
    for (const item of row.items) {
      const allocated = row.allocations
        .filter(
          (a) =>
            a.settlementItemId === item.id && a.status === SettlementAllocationStatus.ACTIVE,
        )
        .reduce((acc, a) => acc.plus(a.amount), new Prisma.Decimal(0));
      const remaining = item.originalAmount.minus(allocated);
      let derivedStatus: SettlementItemView['derivedStatus'] = 'OPEN';
      if (allocated.gt(0) && remaining.gt(0)) derivedStatus = 'PARTIALLY_SETTLED';
      if (allocated.gt(0) && remaining.lte(0)) derivedStatus = 'SETTLED';
      originalTotal = originalTotal.plus(item.originalAmount);
      allocatedTotal = allocatedTotal.plus(allocated);
      itemViews.push({
        id: item.id,
        settlementId: item.settlementId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        currency: item.currency,
        originalAmount: item.originalAmount.toString(),
        allocatedAmount: allocated.toString(),
        remainingAmount: remaining.toString(),
        derivedStatus,
      });
    }
    return {
      id: row.id,
      companyId: row.companyId,
      number: row.number,
      type: row.type,
      status: row.status,
      partyId: row.partyId,
      currency: row.currency,
      settlementDate: row.settlementDate?.toISOString() ?? null,
      reference: row.reference,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      items: itemViews,
      allocations: row.allocations.map((a) => ({
        id: a.id,
        settlementId: a.settlementId,
        settlementItemId: a.settlementItemId,
        financeTxnType: a.financeTxnType,
        financeTxnId: a.financeTxnId,
        paymentId: a.paymentId,
        amount: a.amount.toString(),
        currency: a.currency,
        paymentAmount: a.paymentAmount.toString(),
        paymentCurrency: a.paymentCurrency,
        status: a.status,
        allocatedAt: a.allocatedAt.toISOString(),
        reversedAt: a.reversedAt?.toISOString() ?? null,
        reverseReason: a.reverseReason,
        fx: a.fxDetail
          ? {
              rate: a.fxDetail.rate.toString(),
              rateBaseCurrency: a.fxDetail.rateBaseCurrency,
              rateQuoteCurrency: a.fxDetail.rateQuoteCurrency,
              rateDate: a.fxDetail.rateDate.toISOString(),
              rateSourceType: a.fxDetail.rateSourceType,
              roundingDifference: a.fxDetail.roundingDifference.toString(),
            }
          : null,
      })),
      totals: {
        originalAmount: originalTotal.toString(),
        allocatedAmount: allocatedTotal.toString(),
        remainingAmount: originalTotal.minus(allocatedTotal).toString(),
      },
    };
  }

  private async requireSettlement(tx: Tx | DatabaseService['client'], companyId: string, id: string) {
    const row = await (tx as Tx).settlement.findFirst({ where: { id, companyId } });
    if (!row) throw this.notFound();
    return row;
  }

  private async requireParty(tx: Tx | DatabaseService['client'], companyId: string, partyId: string) {
    const party = await (tx as Tx).party.findFirst({ where: { id: partyId, companyId } });
    if (!party) {
      throw new AppError({
        code: ERROR_CODES.PARTY_NOT_FOUND,
        message: 'Party was not found.',
        statusCode: 404,
      });
    }
  }

  private async lockSettlement(tx: Tx, companyId: string, settlementId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM settlements
      WHERE id = ${settlementId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    if (!rows[0]) throw this.notFound();
  }

  private async lockSettlementItem(tx: Tx, companyId: string, itemId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM settlement_items
      WHERE id = ${itemId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
  }

  private parseAmount(value: string, currency: CurrencyCode): Prisma.Decimal {
    try {
      return parseMoneyAmount(value, currency);
    } catch {
      throw new AppError({
        code: ERROR_CODES.SETTLEMENT_INVALID_MONEY,
        message: SETTLEMENT_ERROR_MESSAGES.INVALID_AMOUNT,
        statusCode: 400,
      });
    }
  }

  private notFound(): AppError {
    return new AppError({
      code: ERROR_CODES.SETTLEMENT_NOT_FOUND,
      message: SETTLEMENT_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }

  private requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Authentication is required.',
        statusCode: 401,
      });
    }
    return userId;
  }
}
