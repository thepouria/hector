import { Injectable } from '@nestjs/common';
import {
  LedgerAccountKind,
  LedgerAccountStatus,
  LedgerAccountType,
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
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import type { CompanyContext } from '../companies/types/company.types';
import {
  JOURNAL_ERROR_MESSAGES,
  LEDGER_CODE_MAX_LENGTH,
  LEDGER_NAME_MAX_LENGTH,
  LEDGER_SYSTEM_KEYS,
  type LedgerSystemKey,
} from './finance-journals.constants';
import type {
  CreateLedgerAccountDto,
  ListLedgerAccountsQueryDto,
} from './dto/ledger-account.dto';
import type { LedgerAccountView } from './types/finance-journal.types';
import { ensureCompanyChartOfAccounts } from './ledger-coa-seed';

type Tx = Prisma.TransactionClient;

@Injectable()
export class LedgerAccountsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListLedgerAccountsQueryDto,
  ): Promise<{ data: LedgerAccountView[]; meta: PaginationMeta }> {
    await ensureCompanyChartOfAccounts(this.database.client, company.companyId);

    const where: Prisma.LedgerAccountWhereInput = {
      companyId: company.companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
              { systemKey: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.database.client.$transaction([
      this.database.client.ledgerAccount.count({ where }),
      this.database.client.ledgerAccount.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        skip,
        take: query.pageSize,
      }),
    ]);
    return {
      data: rows.map((r) => this.toView(r)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, id: string): Promise<LedgerAccountView> {
    const row = await this.database.client.ledgerAccount.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
        message: JOURNAL_ERROR_MESSAGES.LEDGER_ACCOUNT_NOT_FOUND,
        statusCode: 404,
      });
    }
    return this.toView(row);
  }

  async create(
    company: CompanyContext,
    dto: CreateLedgerAccountDto,
  ): Promise<LedgerAccountView> {
    const actorUserId = this.requireActorUserId();
    const code = dto.code.trim().toUpperCase();
    const name = dto.name.trim();
    if (!code || code.length > LEDGER_CODE_MAX_LENGTH) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: JOURNAL_ERROR_MESSAGES.LEDGER_CODE_TAKEN,
        statusCode: 400,
      });
    }
    if (!name || name.length > LEDGER_NAME_MAX_LENGTH) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Invalid ledger account name',
        statusCode: 400,
      });
    }

    try {
      const row = await this.database.client.$transaction(async (tx) => {
        if (dto.parentId) {
          const parent = await tx.ledgerAccount.findFirst({
            where: { id: dto.parentId, companyId: company.companyId },
          });
          if (!parent) {
            throw new AppError({
              code: ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
              message: JOURNAL_ERROR_MESSAGES.LEDGER_ACCOUNT_NOT_FOUND,
              statusCode: 404,
            });
          }
        }
        const created = await tx.ledgerAccount.create({
          data: {
            companyId: company.companyId,
            code,
            name,
            type: dto.type,
            kind: LedgerAccountKind.USER_DEFINED,
            status: LedgerAccountStatus.ACTIVE,
            parentId: dto.parentId ?? null,
            description: dto.description?.trim() || null,
            createdById: actorUserId,
          },
        });
        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.LEDGER_ACCOUNT_CREATED,
          entityType: AUDIT_ENTITY_TYPES.LEDGER_ACCOUNT,
          entityId: created.id,
          before: null,
          after: { code: created.code, name: created.name, type: created.type },
        });
        return created;
      });
      return this.toView(row);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError({
          code: ERROR_CODES.LEDGER_ACCOUNT_CODE_TAKEN,
          message: JOURNAL_ERROR_MESSAGES.LEDGER_CODE_TAKEN,
          statusCode: 409,
        });
      }
      throw error;
    }
  }

  async archive(company: CompanyContext, id: string): Promise<LedgerAccountView> {
    const actorUserId = this.requireActorUserId();
    const row = await this.database.client.$transaction(async (tx) => {
      const existing = await tx.ledgerAccount.findFirst({
        where: { id, companyId: company.companyId },
      });
      if (!existing) {
        throw new AppError({
          code: ERROR_CODES.LEDGER_ACCOUNT_NOT_FOUND,
          message: JOURNAL_ERROR_MESSAGES.LEDGER_ACCOUNT_NOT_FOUND,
          statusCode: 404,
        });
      }
      if (existing.status === LedgerAccountStatus.ARCHIVED) {
        return existing;
      }
      if (existing.kind === LedgerAccountKind.SYSTEM) {
        throw new AppError({
          code: ERROR_CODES.LEDGER_ACCOUNT_INACTIVE,
          message: 'System ledger accounts cannot be archived.',
          statusCode: 409,
        });
      }
      const updated = await tx.ledgerAccount.update({
        where: { id },
        data: {
          status: LedgerAccountStatus.ARCHIVED,
          archivedAt: new Date(),
          archivedById: actorUserId,
        },
      });
      await this.auditService.record(tx, {
        action: AUDIT_ACTIONS.LEDGER_ACCOUNT_ARCHIVED,
        entityType: AUDIT_ENTITY_TYPES.LEDGER_ACCOUNT,
        entityId: updated.id,
        before: { status: existing.status },
        after: { status: updated.status },
      });
      return updated;
    });
    return this.toView(row);
  }

  async resolveSystemKey(
    tx: Tx,
    companyId: string,
    systemKey: LedgerSystemKey,
  ): Promise<{ id: string; code: string; name: string; type: LedgerAccountType }> {
    await ensureCompanyChartOfAccounts(tx, companyId);
    const row = await tx.ledgerAccount.findFirst({
      where: {
        companyId,
        systemKey,
        status: LedgerAccountStatus.ACTIVE,
      },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.LEDGER_SYSTEM_KEY_NOT_FOUND,
        message: JOURNAL_ERROR_MESSAGES.SYSTEM_KEY_NOT_FOUND,
        statusCode: 409,
      });
    }
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
    };
  }

  async resolveFinancialAccountLedger(
    tx: Tx,
    companyId: string,
    financialAccountId: string,
  ): Promise<{ id: string }> {
    await ensureCompanyChartOfAccounts(tx, companyId);
    const account = await tx.financialAccount.findFirst({
      where: { id: financialAccountId, companyId },
      select: { id: true, ledgerAccountId: true, code: true, name: true },
    });
    if (!account) {
      throw new AppError({
        code: ERROR_CODES.FINANCIAL_ACCOUNT_NOT_FOUND,
        message: 'Financial account not found',
        statusCode: 404,
      });
    }
    if (account.ledgerAccountId) {
      return { id: account.ledgerAccountId };
    }

    // Lazy map: create child under CASH_AND_BANK and link.
    const parent = await this.resolveSystemKey(
      tx,
      companyId,
      LEDGER_SYSTEM_KEYS.CASH_AND_BANK,
    );
    const code = `CASH-${account.code}`.slice(0, LEDGER_CODE_MAX_LENGTH);
    const created = await tx.ledgerAccount.create({
      data: {
        companyId,
        code,
        name: account.name,
        type: LedgerAccountType.ASSET,
        kind: LedgerAccountKind.USER_DEFINED,
        status: LedgerAccountStatus.ACTIVE,
        parentId: parent.id,
        description: `Mapped from FinancialAccount ${account.code}`,
      },
    });
    await tx.financialAccount.update({
      where: { id: account.id },
      data: { ledgerAccountId: created.id },
    });
    return { id: created.id };
  }

  private toView(row: {
    id: string;
    code: string;
    name: string;
    type: LedgerAccountType;
    systemKey: string | null;
    kind: LedgerAccountKind;
    status: LedgerAccountStatus;
    parentId: string | null;
    description: string | null;
    createdAt: Date;
    archivedAt: Date | null;
  }): LedgerAccountView {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type,
      systemKey: row.systemKey,
      kind: row.kind,
      status: row.status,
      parentId: row.parentId,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
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
