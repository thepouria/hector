import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
  Prisma,
  ReceiptStatus,
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
  RECEIPT_COUNTERPARTY_NAME_MAX_LENGTH,
  RECEIPT_ERROR_MESSAGES,
  RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH,
  RECEIPT_NOTES_MAX_LENGTH,
  RECEIPT_REFERENCE_MAX_LENGTH,
  RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH,
} from './finance-payments-receipts.constants';
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import { parseMoneyAmount } from './money/money';
import { allocateReceiptSequence, formatReceiptNumber } from './payment-numbering';
import type {
  CreateReceiptDto,
  ListReceiptsQueryDto,
  ReverseReceiptDto,
  UpdateReceiptDto,
} from './dto/receipt.dto';
import type { ReceiptView } from './types/finance-payment-receipt.types';

const detailInclude = {
  account: {
    select: { id: true, code: true, name: true, currency: true, status: true },
  },
} satisfies Prisma.ReceiptInclude;

type DetailRow = Prisma.ReceiptGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListReceiptsQueryDto,
  ): Promise<{ data: ReceiptView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const where: Prisma.ReceiptWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
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
      this.database.client.receipt.count({ where }),
      this.database.client.receipt.findMany({
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

  async get(company: CompanyContext, id: string): Promise<ReceiptView> {
    return this.toView(await this.requireDetail(company.companyId, id));
  }

  async create(company: CompanyContext, dto: CreateReceiptDto): Promise<ReceiptView> {
    const actorUserId = this.requireActorUserId();
    const notes = assertOptionalText(
      dto.notes,
      RECEIPT_NOTES_MAX_LENGTH,
      RECEIPT_ERROR_MESSAGES.INVALID_NOTES,
    );
    const reference = assertOptionalText(
      dto.reference,
      RECEIPT_REFERENCE_MAX_LENGTH,
      RECEIPT_ERROR_MESSAGES.INVALID_REFERENCE,
    );
    const externalReference = assertOptionalText(
      dto.externalReference,
      RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH,
      RECEIPT_ERROR_MESSAGES.INVALID_EXTERNAL_REFERENCE,
    );
    const counterpartyName = this.assertOptionalCounterpartyName(dto.counterpartyName);
    const sourceReferenceType = assertOptionalText(
      dto.sourceReferenceType,
      RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH,
      RECEIPT_ERROR_MESSAGES.INVALID_SOURCE_REFERENCE_TYPE,
    );
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();
    const postImmediately = dto.postImmediately === true;

    return commitThenPublish(this.eventBus, async (events) => {
      const existing = await this.database.client.receipt.findFirst({
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

          const seq = await allocateReceiptSequence(tx, company.companyId);
          const number = formatReceiptNumber(seq);

          let row = await tx.receipt.create({
            data: {
              companyId: company.companyId,
              number,
              accountId: account.id,
              amount,
              currency: account.currency,
              status: ReceiptStatus.DRAFT,
              effectiveAt,
              counterpartyType: dto.counterpartyType ?? null,
              counterpartyId: dto.counterpartyId ?? null,
              counterpartyName,
              sourceType: dto.sourceType,
              sourceReferenceType,
              sourceReferenceId: dto.sourceReferenceId ?? null,
              reference,
              externalReference,
              notes,
              requestId: dto.requestId,
              createdById: actorUserId,
            },
            include: detailInclude,
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.RECEIPT_CREATED,
            entityType: AUDIT_ENTITY_TYPES.RECEIPT,
            entityId: row.id,
            before: null,
            after: {
              number: row.number,
              sourceType: row.sourceType,
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
              type: DOMAIN_EVENTS.RECEIPT_POSTED,
              payload: {
                companyId: company.companyId,
                receiptId: result.row.id,
                number: result.row.number,
                sourceType: result.row.sourceType,
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
          const again = await this.database.client.receipt.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: detailInclude,
          });
          if (again) {
            this.assertIdempotentCreate(again, dto);
            return this.toView(again);
          }
          throw new AppError({
            code: ERROR_CODES.RECEIPT_IDEMPOTENCY_CONFLICT,
            message: RECEIPT_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
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
    dto: UpdateReceiptDto,
  ): Promise<ReceiptView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async () => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockReceipt(tx, company.companyId, id);
        if (locked.status !== ReceiptStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.RECEIPT_NOT_EDITABLE,
            message: RECEIPT_ERROR_MESSAGES.NOT_EDITABLE,
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

        const row = await tx.receipt.update({
          where: { id: locked.id },
          data: {
            accountId,
            amount,
            currency,
            sourceType: dto.sourceType ?? locked.sourceType,
            counterpartyType:
              dto.counterpartyType !== undefined ? dto.counterpartyType : locked.counterpartyType,
            counterpartyId:
              dto.counterpartyId !== undefined ? dto.counterpartyId : locked.counterpartyId,
            counterpartyName:
              dto.counterpartyName !== undefined
                ? this.assertOptionalCounterpartyName(dto.counterpartyName)
                : locked.counterpartyName,
            sourceReferenceType:
              dto.sourceReferenceType !== undefined
                ? assertOptionalText(
                    dto.sourceReferenceType,
                    RECEIPT_SOURCE_REFERENCE_TYPE_MAX_LENGTH,
                    RECEIPT_ERROR_MESSAGES.INVALID_SOURCE_REFERENCE_TYPE,
                  )
                : locked.sourceReferenceType,
            sourceReferenceId:
              dto.sourceReferenceId !== undefined
                ? dto.sourceReferenceId
                : locked.sourceReferenceId,
            effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : locked.effectiveAt,
            reference:
              dto.reference !== undefined
                ? assertOptionalText(
                    dto.reference,
                    RECEIPT_REFERENCE_MAX_LENGTH,
                    RECEIPT_ERROR_MESSAGES.INVALID_REFERENCE,
                  )
                : locked.reference,
            externalReference:
              dto.externalReference !== undefined
                ? assertOptionalText(
                    dto.externalReference,
                    RECEIPT_EXTERNAL_REFERENCE_MAX_LENGTH,
                    RECEIPT_ERROR_MESSAGES.INVALID_EXTERNAL_REFERENCE,
                  )
                : locked.externalReference,
            notes:
              dto.notes !== undefined
                ? assertOptionalText(
                    dto.notes,
                    RECEIPT_NOTES_MAX_LENGTH,
                    RECEIPT_ERROR_MESSAGES.INVALID_NOTES,
                  )
                : locked.notes,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.RECEIPT_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.RECEIPT,
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

  async post(company: CompanyContext, id: string): Promise<ReceiptView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        return this.postInTx(tx, company.companyId, id, actorUserId);
      });

      if (row.status === ReceiptStatus.POSTED) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.RECEIPT_POSTED,
            payload: {
              companyId: company.companyId,
              receiptId: row.id,
              number: row.number,
              sourceType: row.sourceType,
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

  async cancel(company: CompanyContext, id: string): Promise<ReceiptView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const row = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockReceipt(tx, company.companyId, id);
        if (locked.status === ReceiptStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, id);
        }
        if (locked.status !== ReceiptStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.RECEIPT_NOT_CANCELLABLE,
            message: RECEIPT_ERROR_MESSAGES.NOT_CANCELLABLE,
            statusCode: 409,
          });
        }

        const updated = await tx.receipt.update({
          where: { id: locked.id },
          data: {
            status: ReceiptStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.RECEIPT_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.RECEIPT,
          entityId: updated.id,
          before: { status: locked.status },
          after: { status: updated.status },
        });

        return updated;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.RECEIPT_CANCELLED,
          payload: {
            companyId: company.companyId,
            receiptId: row.id,
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
    dto: ReverseReceiptDto,
  ): Promise<ReceiptView> {
    const actorUserId = this.requireActorUserId();
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new AppError({
        code: ERROR_CODES.RECEIPT_REVERSAL_REASON_REQUIRED,
        message: RECEIPT_ERROR_MESSAGES.REVERSAL_REASON_REQUIRED,
        statusCode: 400,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockReceipt(tx, company.companyId, id);
        if (locked.status === ReceiptStatus.REVERSED) {
          const existingReversal = await tx.receipt.findFirst({
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
        if (locked.status !== ReceiptStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.RECEIPT_NOT_REVERSIBLE,
            message: RECEIPT_ERROR_MESSAGES.NOT_REVERSIBLE,
            statusCode: 409,
          });
        }

        const now = new Date();
        const seq = await allocateReceiptSequence(tx, company.companyId);
        const number = formatReceiptNumber(seq);

        const reversal = await tx.receipt.create({
          data: {
            companyId: company.companyId,
            number,
            accountId: locked.accountId,
            amount: locked.amount,
            currency: locked.currency,
            status: ReceiptStatus.POSTED,
            effectiveAt: now,
            counterpartyType: locked.counterpartyType,
            counterpartyId: locked.counterpartyId,
            counterpartyName: locked.counterpartyName,
            sourceType: locked.sourceType,
            sourceReferenceType: locked.sourceReferenceType,
            sourceReferenceId: locked.sourceReferenceId,
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
          checkBalances: true,
          postedAt: now,
          lines: [
            {
              accountId: locked.accountId,
              direction: FinancialAccountMovementDirection.OUT,
              amount: locked.amount,
              currency: locked.currency,
              type: FinancialAccountMovementType.REVERSAL,
              sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.RECEIPT,
              sourceId: reversal.id,
              effectiveAt: now,
              description: `Reversal of ${locked.number}: ${reason}`,
            },
          ],
        });

        const original = await tx.receipt.update({
          where: { id: locked.id },
          data: {
            status: ReceiptStatus.REVERSED,
            reversedAt: now,
            reversedById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.RECEIPT_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.RECEIPT,
          entityId: original.id,
          before: { status: ReceiptStatus.POSTED },
          after: {
            status: ReceiptStatus.REVERSED,
            reversalId: reversal.id,
          },
          metadata: { reason },
        });

        return { original, reversal };
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.RECEIPT_REVERSED,
          payload: {
            companyId: company.companyId,
            receiptId: result.original.id,
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
    const locked = await this.lockReceipt(tx, companyId, id);
    if (locked.status === ReceiptStatus.POSTED) {
      return this.loadDetailInTx(tx, companyId, id);
    }
    if (locked.status !== ReceiptStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.RECEIPT_NOT_POSTABLE,
        message: RECEIPT_ERROR_MESSAGES.NOT_POSTABLE,
        statusCode: 409,
      });
    }

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
          sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.RECEIPT,
          sourceId: locked.id,
          effectiveAt: locked.effectiveAt,
          description: `Receipt ${locked.number}`,
        },
      ],
    });

    const updated = await tx.receipt.update({
      where: { id: locked.id },
      data: {
        status: ReceiptStatus.POSTED,
        postedAt: now,
        postedById: actorUserId,
      },
      include: detailInclude,
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.RECEIPT_POSTED,
      entityType: AUDIT_ENTITY_TYPES.RECEIPT,
      entityId: updated.id,
      before: { status: ReceiptStatus.DRAFT },
      after: {
        status: ReceiptStatus.POSTED,
        amount: locked.amount.toFixed(),
        currency: locked.currency,
        sourceType: locked.sourceType,
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
        code: ERROR_CODES.RECEIPT_ACCOUNT_INACTIVE,
        message: RECEIPT_ERROR_MESSAGES.ACCOUNT_INACTIVE,
        statusCode: 409,
      });
    }

    let amount: Prisma.Decimal;
    try {
      amount = parseMoneyAmount(amountRaw, account.currency);
    } catch {
      throw AppError.validation(RECEIPT_ERROR_MESSAGES.INVALID_MONEY);
    }

    return { account, amount };
  }

  private assertOptionalCounterpartyName(value: string | null | undefined): string | null {
    if (value == null) return null;
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length === 0) return null;
    if (name.length > RECEIPT_COUNTERPARTY_NAME_MAX_LENGTH) {
      throw AppError.validation(RECEIPT_ERROR_MESSAGES.INVALID_COUNTERPARTY_NAME);
    }
    return name;
  }

  private assertIdempotentCreate(existing: DetailRow, dto: CreateReceiptDto): void {
    if (
      existing.sourceType !== dto.sourceType ||
      existing.accountId !== dto.accountId ||
      existing.amount.toFixed() !== parseMoneyAmount(dto.amount, existing.currency).toFixed()
    ) {
      throw new AppError({
        code: ERROR_CODES.RECEIPT_IDEMPOTENCY_CONFLICT,
        message: RECEIPT_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private async lockReceipt(tx: Tx, companyId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM receipts
      WHERE company_id = ${companyId}::uuid AND id = ${id}::uuid
      FOR UPDATE
    `);
    if (rows.length === 0) {
      throw new AppError({
        code: ERROR_CODES.RECEIPT_NOT_FOUND,
        message: RECEIPT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return tx.receipt.findFirstOrThrow({
      where: { id, companyId },
    });
  }

  private async requireDetail(companyId: string, id: string): Promise<DetailRow> {
    const row = await this.database.client.receipt.findFirst({
      where: { id, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.RECEIPT_NOT_FOUND,
        message: RECEIPT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async loadDetailInTx(tx: Tx, companyId: string, id: string): Promise<DetailRow> {
    return tx.receipt.findFirstOrThrow({
      where: { id, companyId },
      include: detailInclude,
    });
  }

  private toView(row: DetailRow): ReceiptView {
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
      sourceType: row.sourceType,
      sourceReferenceType: row.sourceReferenceType,
      sourceReferenceId: row.sourceReferenceId,
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
