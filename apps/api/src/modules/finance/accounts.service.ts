import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  FinancialAccountMovementDirection,
  FinancialAccountMovementType,
  FinancialAccountStatus,
  FinancialAccountType,
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
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import type { CompanyContext } from '../companies/types/company.types';
import { computeAccountBalance, lockAccountForUpdate } from './accounts.balance';
import {
  FINANCE_ACCOUNT_SOURCE_TYPES,
  FINANCIAL_ACCOUNT_ERROR_MESSAGES,
} from './finance-accounts.constants';
import {
  assertAccountCode,
  assertAccountName,
  assertOptionalAccountNumber,
  assertOptionalBankName,
  assertOptionalDescription,
  assertOptionalIban,
  mapFinancialAccountUniqueViolation,
  normalizeSearchQuery,
} from './finance-accounts.normalization';
import { parseMoneyAmount } from './money/money';
import type {
  CreateFinancialAccountDto,
  ListAccountMovementsQueryDto,
  ListFinancialAccountsQueryDto,
  RecordOpeningBalanceDto,
  UpdateFinancialAccountDto,
} from './dto/financial-account.dto';
import type {
  AccountsSummaryView,
  FinancialAccountMovementView,
  FinancialAccountOptionView,
  FinancialAccountView,
  MoneyView,
} from './types/finance-account.types';

type AccountRow = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: FinancialAccountType;
  currency: CurrencyCode;
  status: FinancialAccountStatus;
  isDefault: boolean;
  description: string | null;
  bankName: string | null;
  accountNumber: string | null;
  iban: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AccountsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListFinancialAccountsQueryDto,
  ): Promise<{
    data: (FinancialAccountView | FinancialAccountOptionView)[];
    meta: PaginationMeta;
  }> {
    const search = normalizeSearchQuery(query.search);
    const where: Prisma.FinancialAccountWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.isDefault !== undefined ? { isDefault: query.isDefault } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
              { bankName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.FinancialAccountOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

    if (query.view === 'options') {
      const [total, rows] = await this.database.client.$transaction([
        this.database.client.financialAccount.count({ where }),
        this.database.client.financialAccount.findMany({
          where,
          orderBy,
          skip,
          take: query.pageSize,
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            currency: true,
            status: true,
            isDefault: true,
          },
        }),
      ]);
      return {
        data: rows,
        meta: buildPaginationMeta(query.page, query.pageSize, total),
      };
    }

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.financialAccount.count({ where }),
      this.database.client.financialAccount.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);

    const withBalances = await Promise.all(
      rows.map(async (row) => {
        const balance = await computeAccountBalance(
          this.database.client,
          company.companyId,
          row.id,
        );
        return this.toView(row, balance);
      }),
    );

    return {
      data: withBalances,
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, accountId: string): Promise<FinancialAccountView> {
    const row = await this.requireAccount(company.companyId, accountId);
    const balance = await computeAccountBalance(
      this.database.client,
      company.companyId,
      accountId,
    );
    return this.toView(row, balance);
  }

  async getBalance(company: CompanyContext, accountId: string): Promise<MoneyView> {
    const row = await this.requireAccount(company.companyId, accountId);
    const balance = await computeAccountBalance(
      this.database.client,
      company.companyId,
      accountId,
    );
    return { amount: balance.toFixed(), currency: row.currency };
  }

  async summary(company: CompanyContext): Promise<AccountsSummaryView> {
    const accounts = await this.database.client.financialAccount.findMany({
      where: {
        companyId: company.companyId,
        status: { not: FinancialAccountStatus.ARCHIVED },
      },
      orderBy: [{ currency: 'asc' }, { name: 'asc' }],
    });

    const buckets = new Map<
      CurrencyCode,
      {
        currency: CurrencyCode;
        total: Prisma.Decimal;
        accounts: AccountsSummaryView['byCurrency'][number]['accounts'];
      }
    >();

    for (const account of accounts) {
      const balance = await computeAccountBalance(
        this.database.client,
        company.companyId,
        account.id,
      );
      let bucket = buckets.get(account.currency);
      if (!bucket) {
        bucket = { currency: account.currency, total: new Prisma.Decimal(0), accounts: [] };
        buckets.set(account.currency, bucket);
      }
      bucket.total = bucket.total.add(balance);
      bucket.accounts.push({
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        status: account.status,
        isDefault: account.isDefault,
        balance: balance.toFixed(),
      });
    }

    return {
      byCurrency: [...buckets.values()].map((b) => ({
        currency: b.currency,
        total: b.total.toFixed(),
        accounts: b.accounts,
      })),
    };
  }

  async listMovements(
    company: CompanyContext,
    accountId: string,
    query: ListAccountMovementsQueryDto,
  ): Promise<{ data: FinancialAccountMovementView[]; meta: PaginationMeta }> {
    await this.requireAccount(company.companyId, accountId);
    const where: Prisma.FinancialAccountMovementWhereInput = {
      companyId: company.companyId,
      accountId,
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.type ? { type: query.type as FinancialAccountMovementType } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            effectiveAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.financialAccountMovement.count({ where }),
      this.database.client.financialAccountMovement.findMany({
        where,
        orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toMovementView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async create(
    company: CompanyContext,
    dto: CreateFinancialAccountDto,
  ): Promise<FinancialAccountView> {
    const actorUserId = this.requireActorUserId();
    const code = assertAccountCode(dto.code);
    const name = assertAccountName(dto.name);
    const description = assertOptionalDescription(dto.description);
    const bankName = assertOptionalBankName(dto.bankName);
    const accountNumber = assertOptionalAccountNumber(dto.accountNumber);
    const iban = assertOptionalIban(dto.iban);
    const requestDefault = dto.isDefault === true;

    return commitThenPublish(this.eventBus, async (events) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const forceNonDefault = attempt > 0;
        try {
          const created = await this.database.client.$transaction(async (tx) => {
            const makeDefault = !forceNonDefault && requestDefault;
            const previousDefault = makeDefault
              ? await tx.financialAccount.findFirst({
                  where: {
                    companyId: company.companyId,
                    currency: dto.currency,
                    isDefault: true,
                  },
                  select: { id: true },
                })
              : null;

            if (makeDefault) {
              await tx.financialAccount.updateMany({
                where: {
                  companyId: company.companyId,
                  currency: dto.currency,
                  isDefault: true,
                },
                data: { isDefault: false },
              });
            }

            const account = await tx.financialAccount.create({
              data: {
                companyId: company.companyId,
                code,
                name,
                type: dto.type,
                currency: dto.currency,
                status: FinancialAccountStatus.ACTIVE,
                isDefault: makeDefault,
                description,
                bankName,
                accountNumber,
                iban,
                createdById: actorUserId,
              },
            });

            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_CREATED,
              entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT,
              entityId: account.id,
              before: null,
              after: this.snapshot(account),
            });

            if (makeDefault) {
              await this.auditService.record(tx, {
                action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_DEFAULT_CHANGED,
                entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT,
                entityId: account.id,
                before: { previousAccountId: previousDefault?.id ?? null },
                after: {
                  newAccountId: account.id,
                  currency: account.currency,
                  isDefault: true,
                },
                metadata: { companyId: company.companyId },
              });
            }

            return { account, makeDefault, previousDefaultId: previousDefault?.id ?? null };
          });

          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.FINANCIAL_ACCOUNT_CREATED,
              payload: {
                companyId: company.companyId,
                accountId: created.account.id,
                code: created.account.code,
                currency: created.account.currency,
                type: created.account.type,
              },
            }),
          );

          if (created.makeDefault) {
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.FINANCIAL_ACCOUNT_DEFAULT_CHANGED,
                payload: {
                  companyId: company.companyId,
                  currency: created.account.currency,
                  previousAccountId: created.previousDefaultId,
                  newAccountId: created.account.id,
                },
              }),
            );
          }

          return this.toView(created.account, new Prisma.Decimal(0));
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002' &&
            attempt === 0
          ) {
            const target = Array.isArray(error.meta?.target)
              ? (error.meta.target as string[]).join(',')
              : String(error.meta?.target ?? '');
            if (target.includes('one_default') || target.includes('default')) {
              continue;
            }
          }
          if (error instanceof AppError) throw error;
          mapFinancialAccountUniqueViolation(error);
        }
      }
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_DEFAULT_CONFLICT,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.DEFAULT_CONFLICT,
        statusCode: 409,
      });
    });
  }

  async update(
    company: CompanyContext,
    accountId: string,
    dto: UpdateFinancialAccountDto,
  ): Promise<FinancialAccountView> {
    if (dto.balance !== undefined) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_BALANCE_NOT_ACCEPTABLE,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.BALANCE_NOT_ACCEPTABLE,
        statusCode: 400,
      });
    }
    if (dto.currency !== undefined) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_CURRENCY_IMMUTABLE,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.CURRENCY_IMMUTABLE,
        statusCode: 409,
      });
    }

    const current = await this.requireAccount(company.companyId, accountId);
    if (current.status === FinancialAccountStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_ARCHIVED,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.ARCHIVED,
        statusCode: 409,
      });
    }

    if (dto.type !== undefined && dto.type !== current.type) {
      const movementCount = await this.database.client.financialAccountMovement.count({
        where: { companyId: company.companyId, accountId },
      });
      if (movementCount > 0) {
        throw new AppError({
          code: ERROR_CODES.FINANCIAL_ACCOUNT_TYPE_IMMUTABLE,
          message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.TYPE_IMMUTABLE,
          statusCode: 409,
        });
      }
    }

    const name = dto.name !== undefined ? assertAccountName(dto.name) : undefined;
    const description =
      dto.description !== undefined ? assertOptionalDescription(dto.description) : undefined;
    const bankName =
      dto.bankName !== undefined ? assertOptionalBankName(dto.bankName) : undefined;
    const accountNumber =
      dto.accountNumber !== undefined
        ? assertOptionalAccountNumber(dto.accountNumber)
        : undefined;
    const iban = dto.iban !== undefined ? assertOptionalIban(dto.iban) : undefined;
    const type =
      dto.type !== undefined &&
      (dto.type === FinancialAccountType.CASH ||
        dto.type === FinancialAccountType.BANK ||
        dto.type === FinancialAccountType.WALLET ||
        dto.type === FinancialAccountType.OTHER)
        ? (dto.type as FinancialAccountType)
        : undefined;

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const account = await tx.financialAccount.update({
          where: { id: current.id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(bankName !== undefined ? { bankName } : {}),
            ...(accountNumber !== undefined ? { accountNumber } : {}),
            ...(iban !== undefined ? { iban } : {}),
            ...(type !== undefined ? { type } : {}),
          },
        });

        const before = this.snapshot(current);
        const after = this.snapshot(account);
        if (!auditSnapshotsEqual(before, after)) {
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT,
            entityId: account.id,
            before,
            after,
          });
        }

        return account;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.FINANCIAL_ACCOUNT_UPDATED,
          payload: {
            companyId: company.companyId,
            accountId: updated.id,
            code: updated.code,
          },
        }),
      );

      const balance = await computeAccountBalance(
        this.database.client,
        company.companyId,
        updated.id,
      );
      return this.toView(updated, balance);
    });
  }

  async activate(company: CompanyContext, accountId: string): Promise<FinancialAccountView> {
    const current = await this.requireAccount(company.companyId, accountId);
    if (current.status === FinancialAccountStatus.ACTIVE) {
      const balance = await computeAccountBalance(
        this.database.client,
        company.companyId,
        accountId,
      );
      return this.toView(current, balance);
    }
    if (current.status === FinancialAccountStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_INVALID_STATUS_TRANSITION,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_STATUS_TRANSITION,
        statusCode: 409,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const account = await tx.financialAccount.update({
          where: { id: current.id },
          data: { status: FinancialAccountStatus.ACTIVE, archivedAt: null },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_ACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT,
          entityId: account.id,
          before: { status: current.status },
          after: { status: account.status },
        });
        return account;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.FINANCIAL_ACCOUNT_ACTIVATED,
          payload: {
            companyId: company.companyId,
            accountId: updated.id,
            previousStatus: current.status,
            newStatus: updated.status,
          },
        }),
      );

      const balance = await computeAccountBalance(
        this.database.client,
        company.companyId,
        updated.id,
      );
      return this.toView(updated, balance);
    });
  }

  async deactivate(company: CompanyContext, accountId: string): Promise<FinancialAccountView> {
    const current = await this.requireAccount(company.companyId, accountId);
    if (current.status === FinancialAccountStatus.INACTIVE) {
      const balance = await computeAccountBalance(
        this.database.client,
        company.companyId,
        accountId,
      );
      return this.toView(current, balance);
    }
    if (current.status === FinancialAccountStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_INVALID_STATUS_TRANSITION,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_STATUS_TRANSITION,
        statusCode: 409,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        if (current.isDefault) {
          await tx.financialAccount.update({
            where: { id: current.id },
            data: { isDefault: false },
          });
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_DEFAULT_CHANGED,
            entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT,
            entityId: current.id,
            before: { previousAccountId: current.id, isDefault: true },
            after: { newAccountId: null, currency: current.currency, isDefault: false },
            metadata: { companyId: company.companyId, reason: 'default_deactivated' },
          });
        }

        const account = await tx.financialAccount.update({
          where: { id: current.id },
          data: { status: FinancialAccountStatus.INACTIVE, isDefault: false },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_DEACTIVATED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT,
          entityId: account.id,
          before: { status: current.status, isDefault: current.isDefault },
          after: { status: account.status, isDefault: account.isDefault },
        });
        return account;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.FINANCIAL_ACCOUNT_DEACTIVATED,
          payload: {
            companyId: company.companyId,
            accountId: updated.id,
            previousStatus: current.status,
            newStatus: updated.status,
          },
        }),
      );

      const balance = await computeAccountBalance(
        this.database.client,
        company.companyId,
        updated.id,
      );
      return this.toView(updated, balance);
    });
  }

  async archive(company: CompanyContext, accountId: string): Promise<FinancialAccountView> {
    const current = await this.requireAccount(company.companyId, accountId);
    if (current.status === FinancialAccountStatus.ARCHIVED) {
      return this.toView(current, new Prisma.Decimal(0));
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        await lockAccountForUpdate(tx, company.companyId, accountId);
        const balance = await computeAccountBalance(tx, company.companyId, accountId);
        if (!balance.isZero()) {
          throw new AppError({
            code: ERROR_CODES.FINANCIAL_ACCOUNT_ARCHIVE_BALANCE_NOT_ZERO,
            message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.ARCHIVE_BALANCE_NOT_ZERO,
            statusCode: 409,
          });
        }

        const account = await tx.financialAccount.update({
          where: { id: current.id },
          data: {
            status: FinancialAccountStatus.ARCHIVED,
            isDefault: false,
            archivedAt: new Date(),
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT,
          entityId: account.id,
          before: { status: current.status, isDefault: current.isDefault },
          after: { status: account.status, isDefault: account.isDefault },
        });

        return account;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.FINANCIAL_ACCOUNT_ARCHIVED,
          payload: {
            companyId: company.companyId,
            accountId: updated.id,
            code: updated.code,
          },
        }),
      );

      return this.toView(updated, new Prisma.Decimal(0));
    });
  }

  async setDefault(company: CompanyContext, accountId: string): Promise<FinancialAccountView> {
    const current = await this.requireAccount(company.companyId, accountId);
    if (current.status !== FinancialAccountStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_DEFAULT_REQUIRES_ACTIVE,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.DEFAULT_REQUIRES_ACTIVE,
        statusCode: 409,
      });
    }
    if (current.isDefault) {
      const balance = await computeAccountBalance(
        this.database.client,
        company.companyId,
        accountId,
      );
      return this.toView(current, balance);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const result = await this.database.client.$transaction(async (tx) => {
          await lockAccountForUpdate(tx, company.companyId, accountId);
          const previousDefault = await tx.financialAccount.findFirst({
            where: {
              companyId: company.companyId,
              currency: current.currency,
              isDefault: true,
            },
            select: { id: true },
          });

          await tx.financialAccount.updateMany({
            where: {
              companyId: company.companyId,
              currency: current.currency,
              isDefault: true,
            },
            data: { isDefault: false },
          });

          const account = await tx.financialAccount.update({
            where: { id: current.id },
            data: { isDefault: true },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.FINANCIAL_ACCOUNT_DEFAULT_CHANGED,
            entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT,
            entityId: account.id,
            before: { previousAccountId: previousDefault?.id ?? null },
            after: {
              newAccountId: account.id,
              currency: account.currency,
              isDefault: true,
            },
            metadata: { companyId: company.companyId },
          });

          return { account, previousDefaultId: previousDefault?.id ?? null };
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.FINANCIAL_ACCOUNT_DEFAULT_CHANGED,
            payload: {
              companyId: company.companyId,
              currency: result.account.currency,
              previousAccountId: result.previousDefaultId,
              newAccountId: result.account.id,
            },
          }),
        );

        const balance = await computeAccountBalance(
          this.database.client,
          company.companyId,
          result.account.id,
        );
        return this.toView(result.account, balance);
      } catch (error) {
        if (error instanceof AppError) throw error;
        mapFinancialAccountUniqueViolation(error);
      }
    });
  }

  async recordOpeningBalance(
    company: CompanyContext,
    accountId: string,
    dto: RecordOpeningBalanceDto,
  ): Promise<FinancialAccountMovementView> {
    const actorUserId = this.requireActorUserId();
    const account = await this.requireAccount(company.companyId, accountId);
    if (account.status === FinancialAccountStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_ARCHIVED,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.ARCHIVED,
        statusCode: 409,
      });
    }

    let amount: Prisma.Decimal;
    try {
      amount = parseMoneyAmount(dto.amount, account.currency);
    } catch {
      throw AppError.validation(FINANCIAL_ACCOUNT_ERROR_MESSAGES.INVALID_MONEY);
    }

    const description = assertOptionalDescription(dto.description);
    const effectiveAt = dto.effectiveAt ? new Date(dto.effectiveAt) : new Date();

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const existing = await this.database.client.financialAccountMovement.findFirst({
          where: {
            companyId: company.companyId,
            requestId: dto.requestId,
          },
        });
        if (existing) {
          if (
            existing.accountId !== accountId ||
            existing.type !== FinancialAccountMovementType.OPENING_BALANCE ||
            !existing.amount.eq(amount) ||
            existing.currency !== account.currency
          ) {
            throw new AppError({
              code: ERROR_CODES.FINANCIAL_ACCOUNT_OPENING_IDEMPOTENCY_CONFLICT,
              message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.OPENING_IDEMPOTENCY_CONFLICT,
              statusCode: 409,
            });
          }
          return this.toMovementView(existing);
        }

        const movement = await this.database.client.$transaction(async (tx) => {
          await lockAccountForUpdate(tx, company.companyId, accountId);

          const priorOpening = await tx.financialAccountMovement.findFirst({
            where: {
              companyId: company.companyId,
              accountId,
              type: FinancialAccountMovementType.OPENING_BALANCE,
            },
          });
          if (priorOpening) {
            throw new AppError({
              code: ERROR_CODES.FINANCIAL_ACCOUNT_OPENING_ALREADY_EXISTS,
              message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.OPENING_ALREADY_EXISTS,
              statusCode: 409,
            });
          }

          const created = await tx.financialAccountMovement.create({
            data: {
              companyId: company.companyId,
              accountId,
              direction: FinancialAccountMovementDirection.IN,
              amount,
              currency: account.currency,
              type: FinancialAccountMovementType.OPENING_BALANCE,
              sourceType: FINANCE_ACCOUNT_SOURCE_TYPES.OPENING_BALANCE,
              sourceId: null,
              effectiveAt,
              postedAt: new Date(),
              description,
              requestId: dto.requestId,
              createdById: actorUserId,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.OPENING_BALANCE_RECORDED,
            entityType: AUDIT_ENTITY_TYPES.FINANCIAL_ACCOUNT_MOVEMENT,
            entityId: created.id,
            before: null,
            after: {
              accountId,
              amount: amount.toFixed(),
              currency: account.currency,
              requestId: dto.requestId,
            },
            metadata: { accountId, accountCode: account.code },
          });

          return created;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.OPENING_BALANCE_RECORDED,
            payload: {
              companyId: company.companyId,
              accountId,
              movementId: movement.id,
              amount: amount.toFixed(),
              currency: account.currency,
            },
          }),
        );

        return this.toMovementView(movement);
      } catch (error) {
        if (error instanceof AppError) throw error;
        mapFinancialAccountUniqueViolation(error);
      }
    });
  }

  private async requireAccount(companyId: string, accountId: string): Promise<AccountRow> {
    const row = await this.database.client.financialAccount.findFirst({
      where: { id: accountId, companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND,
        message: FINANCIAL_ACCOUNT_ERROR_MESSAGES.NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private toView(row: AccountRow, balance?: Prisma.Decimal): FinancialAccountView {
    return {
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      type: row.type,
      currency: row.currency,
      status: row.status,
      isDefault: row.isDefault,
      description: row.description,
      bankName: row.bankName,
      accountNumber: row.accountNumber,
      iban: row.iban,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(balance !== undefined
        ? { balance: { amount: balance.toFixed(), currency: row.currency } }
        : {}),
    };
  }

  private toMovementView(row: {
    id: string;
    accountId: string;
    direction: FinancialAccountMovementDirection;
    amount: Prisma.Decimal;
    currency: CurrencyCode;
    type: FinancialAccountMovementType;
    sourceType: string;
    sourceId: string | null;
    effectiveAt: Date;
    postedAt: Date;
    description: string | null;
    requestId: string | null;
    createdAt: Date;
  }): FinancialAccountMovementView {
    return {
      id: row.id,
      accountId: row.accountId,
      direction: row.direction,
      amount: row.amount.toFixed(),
      currency: row.currency,
      type: row.type,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      effectiveAt: row.effectiveAt.toISOString(),
      postedAt: row.postedAt.toISOString(),
      description: row.description,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private snapshot(row: AccountRow) {
    return {
      code: row.code,
      name: row.name,
      type: row.type,
      currency: row.currency,
      status: row.status,
      isDefault: row.isDefault,
      description: row.description,
      bankName: row.bankName,
      accountNumber: row.accountNumber,
      iban: row.iban,
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
