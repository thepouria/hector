import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
  FinancialAccountTransferStatus,
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
  allocateAccountTransferSequence,
  formatAccountTransferNumber,
} from './account-transfer-numbering';
import { computeAccountBalance, lockAccountsForUpdate } from './accounts.balance';
import {
  ACCOUNT_TRANSFER_ERROR_MESSAGES,
  ACCOUNT_TRANSFER_NOTES_MAX_LENGTH,
  FINANCE_ACCOUNT_SOURCE_TYPES,
  FINANCIAL_ACCOUNT_ERROR_MESSAGES,
} from './finance-accounts.constants';
import { assertOptionalText, normalizeSearchQuery } from './finance-accounts.normalization';
import { parseMoneyAmount } from './money/money';
import type {
  CreateAccountTransferDto,
  ListAccountTransfersQueryDto,
} from './dto/account-transfer.dto';
import type { AccountTransferView } from './types/finance-account.types';

const detailInclude = {
  sourceAccount: {
    select: { id: true, code: true, name: true, currency: true, status: true },
  },
  destinationAccount: {
    select: { id: true, code: true, name: true, currency: true, status: true },
  },
} satisfies Prisma.FinancialAccountTransferInclude;

type DetailRow = Prisma.FinancialAccountTransferGetPayload<{ include: typeof detailInclude }>;
type Tx = Prisma.TransactionClient;

@Injectable()
export class AccountTransfersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListAccountTransfersQueryDto,
  ): Promise<{ data: AccountTransferView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.q);
    const sourceAccountId = query.fromAccountId ?? query.sourceAccountId;
    const destinationAccountId = query.toAccountId ?? query.destinationAccountId;
    const where: Prisma.FinancialAccountTransferWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(sourceAccountId ? { sourceAccountId } : {}),
      ...(destinationAccountId ? { destinationAccountId } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
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
      this.database.client.financialAccountTransfer.count({ where }),
      this.database.client.financialAccountTransfer.findMany({
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

  async get(company: CompanyContext, transferId: string): Promise<AccountTransferView> {
    return this.toView(await this.requireDetail(company.companyId, transferId));
  }

  async create(
    company: CompanyContext,
    dto: CreateAccountTransferDto,
  ): Promise<AccountTransferView> {
    const actorUserId = this.requireActorUserId();
    const notes = assertOptionalText(
      dto.notes,
      ACCOUNT_TRANSFER_NOTES_MAX_LENGTH,
      ACCOUNT_TRANSFER_ERROR_MESSAGES.INVALID_NOTES,
    );
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();
    const postImmediately = dto.postImmediately === true;

    if (dto.sourceAccountId === dto.destinationAccountId) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_SAME_ACCOUNT,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.SAME_ACCOUNT,
        statusCode: 409,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const existing = await this.database.client.financialAccountTransfer.findFirst({
        where: { companyId: company.companyId, requestId: dto.requestId },
        include: detailInclude,
      });
      if (existing) {
        this.assertIdempotentPayload(existing, dto);
        return this.toView(existing);
      }

      try {
        const result = await this.database.client.$transaction(async (tx) => {
          const { source, destination, amount, currency } = await this.loadAndValidateAccounts(
            tx,
            company.companyId,
            dto,
          );

          const seq = await allocateAccountTransferSequence(tx, company.companyId);
          const number = formatAccountTransferNumber(seq);

          let transfer = await tx.financialAccountTransfer.create({
            data: {
              companyId: company.companyId,
              number,
              sourceAccountId: source.id,
              destinationAccountId: destination.id,
              amount,
              currency,
              status: FinancialAccountTransferStatus.DRAFT,
              effectiveAt,
              notes,
              requestId: dto.requestId,
              createdById: actorUserId,
            },
            include: detailInclude,
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.ACCOUNT_TRANSFER_CREATED,
            entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT_TRANSFER,
            entityId: transfer.id,
            before: null,
            after: {
              number: transfer.number,
              sourceAccountId: transfer.sourceAccountId,
              destinationAccountId: transfer.destinationAccountId,
              amount: amount.toFixed(),
              currency,
              status: transfer.status,
            },
          });

          let posted = false;
          if (postImmediately) {
            transfer = await this.postInTx(tx, company.companyId, transfer.id, actorUserId);
            posted = true;
          }

          return { transfer, posted };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.ACCOUNT_TRANSFER_CREATED,
            payload: {
              companyId: company.companyId,
              transferId: result.transfer.id,
              number: result.transfer.number,
              status: result.transfer.status,
            },
          }),
        );

        if (result.posted) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.ACCOUNT_TRANSFER_POSTED,
              payload: {
                companyId: company.companyId,
                transferId: result.transfer.id,
                number: result.transfer.number,
                sourceAccountId: result.transfer.sourceAccountId,
                destinationAccountId: result.transfer.destinationAccountId,
                amount: result.transfer.amount.toFixed(),
                currency: result.transfer.currency,
              },
            }),
          );
        }

        return this.toView(result.transfer);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const again = await this.database.client.financialAccountTransfer.findFirst({
            where: { companyId: company.companyId, requestId: dto.requestId },
            include: detailInclude,
          });
          if (again) {
            this.assertIdempotentPayload(again, dto);
            return this.toView(again);
          }
          throw new AppError({
            code: ERROR_CODES.ACCOUNT_TRANSFER_IDEMPOTENCY_CONFLICT,
            message: ACCOUNT_TRANSFER_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
            statusCode: 409,
          });
        }
        throw error;
      }
    });
  }

  async post(company: CompanyContext, transferId: string): Promise<AccountTransferView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const transfer = await this.database.client.$transaction(async (tx) => {
        return this.postInTx(tx, company.companyId, transferId, actorUserId);
      });

      if (transfer.status === FinancialAccountTransferStatus.POSTED) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.ACCOUNT_TRANSFER_POSTED,
            payload: {
              companyId: company.companyId,
              transferId: transfer.id,
              number: transfer.number,
              sourceAccountId: transfer.sourceAccountId,
              destinationAccountId: transfer.destinationAccountId,
              amount: transfer.amount.toFixed(),
              currency: transfer.currency,
            },
          }),
        );
      }

      return this.toView(transfer);
    });
  }

  async cancel(company: CompanyContext, transferId: string): Promise<AccountTransferView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const transfer = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, company.companyId, transferId);
        if (locked.status === FinancialAccountTransferStatus.CANCELLED) {
          return this.loadDetailInTx(tx, company.companyId, transferId);
        }
        if (locked.status !== FinancialAccountTransferStatus.DRAFT) {
          throw new AppError({
            code: ERROR_CODES.ACCOUNT_TRANSFER_NOT_CANCELLABLE,
            message: ACCOUNT_TRANSFER_ERROR_MESSAGES.NOT_CANCELLABLE,
            statusCode: 409,
          });
        }

        const updated = await tx.financialAccountTransfer.update({
          where: { id: locked.id },
          data: {
            status: FinancialAccountTransferStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ACCOUNT_TRANSFER_CANCELLED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT_TRANSFER,
          entityId: updated.id,
          before: { status: locked.status },
          after: { status: updated.status },
        });

        return updated;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.ACCOUNT_TRANSFER_CANCELLED,
          payload: {
            companyId: company.companyId,
            transferId: transfer.id,
            number: transfer.number,
          },
        }),
      );

      return this.toView(transfer);
    });
  }

  async reverse(company: CompanyContext, transferId: string): Promise<AccountTransferView> {
    const actorUserId = this.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        const locked = await this.lockTransfer(tx, company.companyId, transferId);
        if (locked.status === FinancialAccountTransferStatus.REVERSED) {
          const existingReversal = await tx.financialAccountTransfer.findFirst({
            where: {
              companyId: company.companyId,
              reversalOfTransferId: locked.id,
            },
            include: detailInclude,
          });
          if (existingReversal) {
            return { original: await this.loadDetailInTx(tx, company.companyId, transferId), reversal: existingReversal };
          }
        }
        if (locked.status !== FinancialAccountTransferStatus.POSTED) {
          throw new AppError({
            code: ERROR_CODES.ACCOUNT_TRANSFER_NOT_REVERSIBLE,
            message: ACCOUNT_TRANSFER_ERROR_MESSAGES.NOT_REVERSIBLE,
            statusCode: 409,
          });
        }

        await lockAccountsForUpdate(tx, company.companyId, [
          locked.sourceAccountId,
          locked.destinationAccountId,
        ]);

        // Reverse: destination OUT, source IN (swap). Check destination has funds.
        const destBalance = await computeAccountBalance(
          tx,
          company.companyId,
          locked.destinationAccountId,
        );
        if (destBalance.lt(locked.amount)) {
          throw new AppError({
            code: ERROR_CODES.FINANCIAL_ACCOUNT_INSUFFICIENT_BALANCE,
            message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.INSUFFICIENT_BALANCE,
            statusCode: 409,
          });
        }

        const now = new Date();
        const seq = await allocateAccountTransferSequence(tx, company.companyId);
        const number = formatAccountTransferNumber(seq);

        const reversal = await tx.financialAccountTransfer.create({
          data: {
            companyId: company.companyId,
            number,
            sourceAccountId: locked.destinationAccountId,
            destinationAccountId: locked.sourceAccountId,
            amount: locked.amount,
            currency: locked.currency,
            status: FinancialAccountTransferStatus.POSTED,
            effectiveAt: now,
            notes: `Reversal of ${locked.number}`,
            createdById: actorUserId,
            postedAt: now,
            postedById: actorUserId,
            reversalOfTransferId: locked.id,
          },
          include: detailInclude,
        });

        await tx.financialAccountMovement.createMany({
          data: [
            {
              companyId: company.companyId,
              accountId: locked.destinationAccountId,
              direction: FinancialAccountMovementDirection.OUT,
              amount: locked.amount,
              currency: locked.currency,
              type: FinancialAccountMovementType.REVERSAL,
              sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.ACCOUNT_TRANSFER,
              sourceId: reversal.id,
              effectiveAt: now,
              postedAt: now,
              description: `Reversal of ${locked.number}`,
              createdById: actorUserId,
            },
            {
              companyId: company.companyId,
              accountId: locked.sourceAccountId,
              direction: FinancialAccountMovementDirection.IN,
              amount: locked.amount,
              currency: locked.currency,
              type: FinancialAccountMovementType.REVERSAL,
              sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.ACCOUNT_TRANSFER,
              sourceId: reversal.id,
              effectiveAt: now,
              postedAt: now,
              description: `Reversal of ${locked.number}`,
              createdById: actorUserId,
            },
          ],
        });

        const original = await tx.financialAccountTransfer.update({
          where: { id: locked.id },
          data: {
            status: FinancialAccountTransferStatus.REVERSED,
            reversedAt: now,
            reversedById: actorUserId,
          },
          include: detailInclude,
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ACCOUNT_TRANSFER_REVERSED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT_TRANSFER,
          entityId: original.id,
          before: { status: FinancialAccountTransferStatus.POSTED },
          after: {
            status: FinancialAccountTransferStatus.REVERSED,
            reversalTransferId: reversal.id,
          },
        });

        return { original, reversal };
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.ACCOUNT_TRANSFER_REVERSED,
          payload: {
            companyId: company.companyId,
            transferId: result.original.id,
            reversalTransferId: result.reversal.id,
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
    transferId: string,
    actorUserId: string,
  ): Promise<DetailRow> {
    const locked = await this.lockTransfer(tx, companyId, transferId);
    if (locked.status === FinancialAccountTransferStatus.POSTED) {
      return this.loadDetailInTx(tx, companyId, transferId);
    }
    if (locked.status === FinancialAccountTransferStatus.REVERSED) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_ALREADY_REVERSED,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.ALREADY_REVERSED,
        statusCode: 409,
      });
    }
    if (locked.status !== FinancialAccountTransferStatus.DRAFT) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_NOT_POSTABLE,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.NOT_POSTABLE,
        statusCode: 409,
      });
    }

    await lockAccountsForUpdate(tx, companyId, [
      locked.sourceAccountId,
      locked.destinationAccountId,
    ]);

    const source = await tx.financialAccount.findFirstOrThrow({
      where: { id: locked.sourceAccountId, companyId },
    });
    const destination = await tx.financialAccount.findFirstOrThrow({
      where: { id: locked.destinationAccountId, companyId },
    });

    if (
      source.status !== FinancialAccountStatus.ACTIVE ||
      destination.status !== FinancialAccountStatus.ACTIVE
    ) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_ACCOUNT_INACTIVE,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.ACCOUNT_INACTIVE,
        statusCode: 409,
      });
    }
    if (source.currency !== destination.currency || source.currency !== locked.currency) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_CROSS_CURRENCY,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.CROSS_CURRENCY,
        statusCode: 409,
      });
    }

    const sourceBalance = await computeAccountBalance(tx, companyId, source.id);
    if (sourceBalance.lt(locked.amount)) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_INSUFFICIENT_BALANCE,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.INSUFFICIENT_BALANCE,
        statusCode: 409,
      });
    }

    const now = new Date();
    await tx.financialAccountMovement.createMany({
      data: [
        {
          companyId,
          accountId: source.id,
          direction: FinancialAccountMovementDirection.OUT,
          amount: locked.amount,
          currency: locked.currency,
          type: FinancialAccountMovementType.TRANSFER_OUT,
          sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.ACCOUNT_TRANSFER,
          sourceId: locked.id,
          effectiveAt: locked.effectiveAt,
          postedAt: now,
          description: `Transfer ${locked.number}`,
          createdById: actorUserId,
        },
        {
          companyId,
          accountId: destination.id,
          direction: FinancialAccountMovementDirection.IN,
          amount: locked.amount,
          currency: locked.currency,
          type: FinancialAccountMovementType.TRANSFER_IN,
          sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.ACCOUNT_TRANSFER,
          sourceId: locked.id,
          effectiveAt: locked.effectiveAt,
          postedAt: now,
          description: `Transfer ${locked.number}`,
          createdById: actorUserId,
        },
      ],
    });

    const updated = await tx.financialAccountTransfer.update({
      where: { id: locked.id },
      data: {
        status: FinancialAccountTransferStatus.POSTED,
        postedAt: now,
        postedById: actorUserId,
      },
      include: detailInclude,
    });

    await this.auditService.record(tx, {
      action: AUDIT_ACTIONS.ACCOUNT_TRANSFER_POSTED,
      entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT_TRANSFER,
      entityId: updated.id,
      before: { status: FinancialAccountTransferStatus.DRAFT },
      after: {
        status: FinancialAccountTransferStatus.POSTED,
        amount: locked.amount.toFixed(),
        currency: locked.currency,
      },
    });

    return updated;
  }

  private async loadAndValidateAccounts(
    tx: Tx,
    companyId: string,
    dto: CreateAccountTransferDto,
  ): Promise<{
    source: { id: string; currency: CurrencyCode; status: FinancialAccountStatus };
    destination: { id: string; currency: CurrencyCode; status: FinancialAccountStatus };
    amount: Prisma.Decimal;
    currency: CurrencyCode;
  }> {
    await lockAccountsForUpdate(tx, companyId, [
      dto.sourceAccountId,
      dto.destinationAccountId,
    ]);

    const source = await tx.financialAccount.findFirst({
      where: { id: dto.sourceAccountId, companyId },
    });
    const destination = await tx.financialAccount.findFirst({
      where: { id: dto.destinationAccountId, companyId },
    });

    if (!source || !destination) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    if (
      source.status !== FinancialAccountStatus.ACTIVE ||
      destination.status !== FinancialAccountStatus.ACTIVE
    ) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_ACCOUNT_INACTIVE,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.ACCOUNT_INACTIVE,
        statusCode: 409,
      });
    }
    if (source.currency !== destination.currency) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_CROSS_CURRENCY,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.CROSS_CURRENCY,
        statusCode: 409,
      });
    }

    let amount: Prisma.Decimal;
    try {
      amount = parseMoneyAmount(dto.amount, source.currency);
    } catch {
      throw AppError.validation(FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_MONEY);
    }

    return { source, destination, amount, currency: source.currency };
  }

  private assertIdempotentPayload(
    existing: DetailRow,
    dto: CreateAccountTransferDto,
  ): void {
    const sameAccounts =
      existing.sourceAccountId === dto.sourceAccountId &&
      existing.destinationAccountId === dto.destinationAccountId;
    const sameAmount = existing.amount.toFixed() === dto.amount.trim();
    if (!sameAccounts || !sameAmount) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_IDEMPOTENCY_CONFLICT,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.IDEMPOTENCY_CONFLICT,
        statusCode: 409,
      });
    }
  }

  private async lockTransfer(
    tx: Tx,
    companyId: string,
    transferId: string,
  ): Promise<{
    id: string;
    number: string;
    sourceAccountId: string;
    destinationAccountId: string;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    status: FinancialAccountTransferStatus;
    effectiveAt: Date;
  }> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        number: string;
        source_account_id: string;
        destination_account_id: string;
        amount: Prisma.Decimal;
        currency: CurrencyCode;
        status: FinancialAccountTransferStatus;
        effective_at: Date;
      }>
    >(Prisma.sql`
      SELECT id, number, source_account_id, destination_account_id, amount, currency, status, effective_at
      FROM financial_account_transfers
      WHERE company_id = ${companyId}::uuid AND id = ${transferId}::uuid
      FOR UPDATE
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_NOT_FOUND,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return {
      id: row.id,
      number: row.number,
      sourceAccountId: row.source_account_id,
      destinationAccountId: row.destination_account_id,
      amount: new Prisma.Decimal(row.amount),
      currency: row.currency,
      status: row.status,
      effectiveAt: row.effective_at,
    };
  }

  private async loadDetailInTx(
    tx: Tx,
    companyId: string,
    transferId: string,
  ): Promise<DetailRow> {
    const row = await tx.financialAccountTransfer.findFirst({
      where: { id: transferId, companyId },
      include: detailInclude,
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ACCOUNT_TRANSFER_NOT_FOUND,
        message: ACCOUNT_TRANSFER_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private async requireDetail(companyId: string, transferId: string): Promise<DetailRow> {
    return this.loadDetailInTx(this.database.client, companyId, transferId);
  }

  private toView(row: DetailRow): AccountTransferView {
    return {
      id: row.id,
      number: row.number,
      status: row.status,
      amount: row.amount.toFixed(),
      currency: row.currency,
      sourceAccount: row.sourceAccount,
      destinationAccount: row.destinationAccount,
      effectiveAt: row.effectiveAt.toISOString(),
      notes: row.notes,
      requestId: row.requestId,
      postedAt: row.postedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      reversedAt: row.reversedAt?.toISOString() ?? null,
      reversalOfTransferId: row.reversalOfTransferId,
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
