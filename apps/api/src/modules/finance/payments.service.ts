import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
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
import { postMovementsInTx } from './account-movements.writer';
import { FINANCE_ACCOUNT_SOURCE_TYPES } from './finance-accounts.constants';
import {
  PAYMENT_COUNTERPARTY_NAME_MAX_LENGTH,
  PAYMENT_ERROR_MESSAGES,
  PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH,
  PAYMENT_NOTES_MAX_LENGTH,
  PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH,
  PAYMENT_REFERENCE_MAX_LENGTH,
} from './finance-payments-receipts.constants';
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import { parseMoneyAmount } from './money/money';
import { allocatePaymentSequence, formatPaymentNumber } from './payment-numbering';
import type {
  CreatePaymentDto,
  ListPaymentsQueryDto,
  ReversePaymentDto,
  UpdatePaymentDto,
} from './dto/payment.dto';
import type { PaymentView } from './types/finance-payment-receipt.types';

const detailInclude = {
  account: {
    select: { id: true, code: true, name: true, currency: true, status: true },
  },
} satisfies Prisma.PaymentInclude;

type DetailRow = Prisma.PaymentGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListPaymentsQueryDto,
  ): Promise<{ data: PaymentView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const where: Prisma.PaymentWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.purposeType ? { purposeType: query.purposeType } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.counterpartyType ? { counterpartyType: query.counterpartyType } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            effectiveAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { counterpartyName: { contains: search, mode: 'insensitive' } },
              { notes: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
              { externalReference: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.payment.count({ where }),
      this.database.client.payment.findMany({
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

  async get(company: CompanyContext, id: string): Promise<PaymentView> {
    return this.toView(await this.requireDetail(company.companyId, id));
  }

  async create(company: CompanyContext, dto: CreatePaymentDto): Promise<PaymentView> {
    const actorUserId = this.requireActorUserId();
    const notes = assertOptionalText(
      dto.notes,
      PAYMENT_NOTES_MAX_LENGTH,
      PAYMENT_ERROR_MESSAGES.INVALID_NOTES,
    );
    const reference = assertOptionalText(
      dto.reference,
      PAYMENT_REFERENCE_MAX_LENGTH,
      PAYMENT_ERROR_MESSAGES.INVALID_REFERENCE,
    );
    const externalReference = assertOptionalText(
      dto.externalReference,
      PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH,
      PAYMENT_ERROR_MESSAGES.INVALID_EXTERNAL_REFERENCE,
    );
    const counterpartyName = this.assertOptionalCounterpartyName(dto.counterpartyName);
    const purposeReferenceType = assertOptionalText(
      dto.purposeReferenceType,
      PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH,
      PAYMENT_ERROR_MESSAGES.INVALID_PURPOSE_REFERENCE_TYPE,
    );
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();
    const postImmediately = dto.postImmediately === true;

    return commitThenPublish(this.eventBus, async (events) => {
      const existing = await this.database.client.payment.findFirst({
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

          const seq = await allocatePaymentSequence(tx, company.companyId);
          const number = formatPaymentNumber(seq);

          let row = await tx.payment.create({
            data: {
              companyId: company.companyId,
              number,
              accountId: account.id,
              amount,
              currency: account.currency,
              status: PaymentStatus.DRAFT,
              effectiveAt,
              counterpartyType: dto.counterpartyType ?? null,
              counterpartyId: dto.counterpartyId ?? null,
              counterpartyName,
              purposeType: dto.purposeType,
              purposeReferenceType,
              purposeReferenceId: dto.purposeReferenceId ?? null,
              reference,
              externalReference,
              notes,
              requestId: dto.requestId,
              createdById: actorUserId,
            },
            include: detailInclude,
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PAYMENT_CREATED,
            entityType: AUDIT_ENTITY_TYPES.PAYMENT,
            entityId: row.id,
            before: null,
            after: {
              number: row.number,
              purposeType: row.purposeType,
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
              type: DOMAIN_EVENTS.PAYMENT_POSTED,
              payload: {
                companyId: company.companyId,
                paymentId: result.row.id,
                number: result.row.number,
                purposeType: result.row.purposeType,
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
          const again = await this.database.client.payment.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: detailInclude,
          });
          if (again) {
            this.assertIdempotentCreate(again, dto);
            return this.toView(again);
          }
          throw new AppError({
            code: ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT,
            message: PAYMENT_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
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
    dto: UpdatePaymentDto,
  ): Promise<PaymentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockPayment(tx, company.companyId, id);
        if (locked.status !== PaymentStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.PAYMENT_NOT_EDITABLE,
            message: PAYMENT_ERROR_MESSAGES.NOT_EDITABLE,
            statusCode: 409,
          });
        }

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

        const row = await tx.payment.update({
          where: { id: locked.id },
          data: {
            accountId,
            amount,
            currency,
            purposeType: dto.purposeType ?? locked.purposeType,
            counterpartyType:
              dto.counterpartyType !== undefined ? dto.counterpartyType : locked.counterpartyType,
            counterpartyId:
              dto.counterpartyId !== undefined ? dto.counterpartyId : locked.counterpartyId,
            counterpartyName:
              dto.counterpartyName !== undefined
                ? this.assertOptionalCounterpartyName(dto.counterpartyName)
                : locked.counterpartyName,
            purposeReferenceType:
              dto.purposeReferenceType !== undefined
                ? assertOptionalText(
                    dto.purposeReferenceType,
                    PAYMENT_PURPOSE_REFERENCE_TYPE_MAX_LENGTH,
                    PAYMENT_ERROR_MESSAGES.INVALID_PURPOSE_REFERENCE_TYPE,
                  )
                : locked.purposeReferenceType,
            purposeReferenceId:
              dto.purposeReferenceId !== undefined
                ? dto.purposeReferenceId
                : locked.purposeReferenceId,
            effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : locked.effectiveAt,
            reference:
              dto.reference !== undefined
                ? assertOptionalText(
                    dto.reference,
                    PAYMENT_REFERENCE_MAX_LENGTH,
                    PAYMENT_ERROR_MESSAGES.INVALID_REFERENCE,
                  )
                : locked.reference,
            externalReference:
              dto.externalReference !== undefined
                ? assertOptionalText(
                    dto.externalReference,
                    PAYMENT_EXTERNAL_REFERENCE_MAX_LENGTH,
                    PAYMENT_ERROR_MESSAGES.INVALID_EXTERNAL_REFERENCE,
                  )
                : locked.externalReference,
            notes:
              dto.notes !== undefined
                ? assertOptionalText(
                    dto.notes,
                    PAYMENT_NOTES_MAX_LENGTH,
                    PAYMENT_ERROR_MESSAGES.INVALID_NOTES,
                  )
                : locked.notes,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PAYMENT_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.PAYMENT,
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

  async post(company: CompanyContext, id: string): Promise<PaymentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        return this.postInTx(tx, company.companyId, id, actorUserId);
      });

      if (row.status === PaymentStatus.POSTED) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PAYMENT_POSTED,
            payload: {
              companyId: company.companyId,
              paymentId: row.id,
              number: row.number,
              purposeType: row.purposeType,
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

  async cancel(company: CompanyContext, id: string): Promise<PaymentView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockPayment(tx, company.companyId, id);
        if (locked.status === PaymentStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, id);
        }
        if (locked.status !== PaymentStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.PAYMENT_NOT_CANCELLABLE,
            message: PAYMENT_ERROR_MESSAGES.NOT_CANCELLABLE,
            statusCode: 409,
          });
        }

        const updated = await tx.payment.update({
          where: { id: locked.id },
          data: {
            status: PaymentStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PAYMENT_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.PAYMENT,
          entityId: updated.id,
          before: { status: locked.status },
          after: { status: updated.status },
        });

        return updated;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PAYMENT_CANCELLED,
          payload: {
            companyId: company.companyId,
            paymentId: row.id,
            number: row.number,
          },
        }),
      );

      return this.toView(row);
    });
  }

  async reverse(
    company: CompanyContext,
    id: string,
    dto: ReversePaymentDto,
  ): Promise<PaymentView> {
    const actorUserId = this.requireActorUserId();
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new AppError({
        code: ERROR_CODES.PAYMENT_REVERSAL_REASON_REQUIRED,
        message: PAYMENT_ERROR_MESSAGES.REVERSAL_REASON_REQUIRED,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockPayment(tx, company.companyId, id);
        if (locked.status === PaymentStatus.REVERSED) {
          const existingReversal = await tx.payment.findFirst({
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
        if (locked.status !== PaymentStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.PAYMENT_NOT_REVERSIBLE,
            message: PAYMENT_ERROR_MESSAGES.NOT_REVERSIBLE,
            statusCode: 409,
          });
        }

        const now = new Date();
        const seq = await allocatePaymentSequence(tx, company.companyId);
        const number = formatPaymentNumber(seq);

        const reversal = await tx.payment.create({
          data: {
            companyId: company.companyId,
            number,
            accountId: locked.accountId,
            amount: locked.amount,
            currency: locked.currency,
            status: PaymentStatus.POSTED,
            effectiveAt: now,
            counterpartyType: locked.counterpartyType,
            counterpartyId: locked.counterpartyId,
            counterpartyName: locked.counterpartyName,
            purposeType: locked.purposeType,
            purposeReferenceType: locked.purposeReferenceType,
            purposeReferenceId: locked.purposeReferenceId,
            notes: `Reversal of ${locked.number}: ${reason}`,
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
          checkBalances: false,
          postedAt: now,
          lines: [
            {
              accountId: locked.accountId,
              direction: FinancialAccountMovementDirection.IN,
              amount: locked.amount,
              currency: locked.currency,
              type: FinancialAccountMovementType.REVERSAL,
              sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.PAYMENT,
              sourceId: reversal.id,
              effectiveAt: now,
              description: `Reversal of ${locked.number}: ${reason}`,
            },
          ],
        });

        const original = await tx.payment.update({
          where: { id: locked.id },
          data: {
            status: PaymentStatus.REVERSED,
            reversedAt: now,
            reversedById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PAYMENT_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.PAYMENT,
          entityId: original.id,
          before: { status: PaymentStatus.POSTED },
          after: {
            status: PaymentStatus.REVERSED,
            reversalId: reversal.id,
          },
          metadata: { reason },
        });

        return { original, reversal };
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PAYMENT_REVERSED,
          payload: {
            companyId: company.companyId,
            paymentId: result.original.id,
            reversalId: result.reversal.id,
            number: result.original.number,
            reason,
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
    const locked = await this.lockPayment(tx, companyId, id);
    if (locked.status === PaymentStatus.POSTED) {
      return this.loadDetailInTx(tx, companyId, id);
    }
    if (locked.status !== PaymentStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.PAYMENT_NOT_POSTABLE,
        message: PAYMENT_ERROR_MESSAGES.NOT_POSTABLE,
        statusCode: 409,
      });
    }

    const now = new Date();
    // Standalone MONEY_OUT. purposeType=SUPPLIER intentionally does NOT touch SupplierPayable.
    await postMovementsInTx(tx, {
      companyId,
      actorUserId,
      checkBalances: true,
      postedAt: now,
      lines: [
        {
          accountId: locked.accountId,
          direction: FinancialAccountMovementDirection.OUT,
          amount: locked.amount,
          currency: locked.currency,
          type: FinancialAccountMovementType.MONEY_OUT,
          sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.PAYMENT,
          sourceId: locked.id,
          effectiveAt: locked.effectiveAt,
          description: `Payment ${locked.number}`,
        },
      ],
    });

    const updated = await tx.payment.update({
      where: { id: locked.id },
      data: {
        status: PaymentStatus.POSTED,
        postedAt: now,
        postedById: actorUserId,
      },
      include: detailInclude,
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.PAYMENT_POSTED,
      entityType: AUDIT_ENTITY_TYPES.PAYMENT,
      entityId: updated.id,
      before: { status: PaymentStatus.DRAFT },
      after: {
        status: PaymentStatus.POSTED,
        amount: locked.amount.toFixed(),
        currency: locked.currency,
        purposeType: locked.purposeType,
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
        code: ERROR_CODES.PAYMENT_ACCOUNT_INACTIVE,
        message: PAYMENT_ERROR_MESSAGES.ACCOUNT_INACTIVE,
        statusCode: 409,
      });
    }

    let amount: Prisma.Decimal;
    try {
      amount = parseMoneyAmount(amountRaw, account.currency);
    } catch {
      throw AppError.validation(PAYMENT_ERROR_MESSAGES.INVALID_MONEY);
    }

    return { account, amount };
  }

  private assertOptionalCounterpartyName(value: string | null | undefined): string | null {
    if (value == null) return null;
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length === 0) return null;
    if (name.length > PAYMENT_COUNTERPARTY_NAME_MAX_LENGTH) {
      throw AppError.validation(PAYMENT_ERROR_MESSAGES.INVALID_COUNTERPARTY_NAME);
    }
    return name;
  }

  private assertIdempotentCreate(existing: DetailRow, dto: CreatePaymentDto): void {
    if (
      existing.purposeType !== dto.purposeType ||
      existing.accountId !== dto.accountId ||
      existing.amount.toFixed() !== parseMoneyAmount(dto.amount, existing.currency).toFixed()
    ) {
      throw new AppError({
        code: ERROR_CODES.PAYMENT_IDEMPOTENCY_CONFLICT,
        message: PAYMENT_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private async lockPayment(tx: Tx, companyId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM payments
      WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid
      FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new AppError({
        code: ERROR_CODES.PAYMENT_NOT_FOUND,
        message: PAYMENT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return tx.payment.findFirstOrThrow({
      where: { id, companyId },
    });
  }

  private async requireDetail(companyId: string, id: string): Promise<DetailRow> {
    const row = await this.database.client.payment.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.PAYMENT_NOT_FOUND,
        message: PAYMENT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(tx: Tx, companyId: string, id: string): Promise<DetailRow> {
    return tx.payment.findFirstOrThrow({
      where: { id, companyId },
      include: detailInclude,
    });
  }

  private toView(row: DetailRow): PaymentView {
    return {
      id: row.id,
      number: row.number,
      account: row.account,
      amount: row.amount.toFixed(),
      currency: row.currency,
      status: row.status,
      effectiveAt: row.effectiveAt.toISOString(),
      counterpartyType: row.counterpartyType,
      counterpartyId: row.counterpartyId,
      counterpartyName: row.counterpartyName,
      purposeType: row.purposeType,
      purposeReferenceType: row.purposeReferenceType,
      purposeReferenceId: row.purposeReferenceId,
      reference: row.reference,
      externalReference: row.externalReference,
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
