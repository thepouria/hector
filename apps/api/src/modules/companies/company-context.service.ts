import { Injectable } from '@nestjs/common';
import {
  CompanyMemberStatus,
  CompanyStatus,
  Prisma,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { COMPANY_ERROR_MESSAGES, OWNER_ROLE_KEY } from './companies.constants';
import type { CompanyContext } from './types/company.types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class CompanyContextService {
  constructor(private readonly database: DatabaseService) {}

  async resolve(userId: string, companyIdHeader: string | undefined): Promise<CompanyContext> {
    if (!companyIdHeader || companyIdHeader.trim().length === 0) {
      throw new AppError({
        code: ERROR_CODES.COMPANY_CONTEXT_REQUIRED,
        message: COMPANY_ERROR_MESSAGES.COMPANY_CONTEXT_REQUIRED,
        statusCode: 400,
      });
    }

    const companyId = companyIdHeader.trim();
    if (!UUID_RE.test(companyId)) {
      throw new AppError({
        code: ERROR_CODES.COMPANY_NOT_FOUND,
        message: COMPANY_ERROR_MESSAGES.COMPANY_NOT_FOUND,
        statusCode: 404,
      });
    }

    const membership = await this.database.client.companyMember.findUnique({
      where: {
        companyId_userId: {
          companyId,
          userId,
        },
      },
      include: {
        company: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    });

    if (!membership || membership.company.deletedAt) {
      throw new AppError({
        code: ERROR_CODES.COMPANY_NOT_FOUND,
        message: COMPANY_ERROR_MESSAGES.COMPANY_NOT_FOUND,
        statusCode: 404,
      });
    }

    if (membership.status === CompanyMemberStatus.SUSPENDED) {
      throw new AppError({
        code: ERROR_CODES.MEMBERSHIP_SUSPENDED,
        message: COMPANY_ERROR_MESSAGES.MEMBERSHIP_SUSPENDED,
        statusCode: 403,
      });
    }

    if (membership.status === CompanyMemberStatus.REMOVED) {
      throw new AppError({
        code: ERROR_CODES.MEMBERSHIP_REMOVED,
        message: COMPANY_ERROR_MESSAGES.MEMBERSHIP_REMOVED,
        statusCode: 403,
      });
    }

    if (membership.status !== CompanyMemberStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.COMPANY_NOT_FOUND,
        message: COMPANY_ERROR_MESSAGES.COMPANY_NOT_FOUND,
        statusCode: 404,
      });
    }

    if (membership.company.status !== CompanyStatus.ACTIVE) {
      throw new AppError({
        code: ERROR_CODES.COMPANY_UNAVAILABLE,
        message: COMPANY_ERROR_MESSAGES.COMPANY_UNAVAILABLE,
        statusCode: 403,
      });
    }

    return {
      companyId: membership.companyId,
      companyMemberId: membership.id,
    };
  }

  async assertOwner(companyId: string, companyMemberId: string): Promise<void> {
    const ownerAssignment = await this.database.client.companyMemberRole.findFirst({
      where: {
        companyMemberId,
        role: {
          companyId,
          key: OWNER_ROLE_KEY,
          deletedAt: null,
        },
      },
      select: { roleId: true },
    });

    if (!ownerAssignment) {
      throw new AppError({
        code: ERROR_CODES.OWNER_REQUIRED,
        message: COMPANY_ERROR_MESSAGES.OWNER_REQUIRED,
        statusCode: 403,
      });
    }
  }

  /**
   * Serializes owner-sensitive mutations per company.
   * Locks the company row so concurrent last-owner checks cannot both succeed.
   */
  async withCompanyLock<T>(
    companyId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.database.client.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM companies
        WHERE id = ${companyId}::uuid
        FOR UPDATE
      `;
      return work(tx);
    });
  }

  async countActiveOwners(
    tx: Prisma.TransactionClient,
    companyId: string,
    excludeMemberId?: string,
  ): Promise<number> {
    return tx.companyMember.count({
      where: {
        companyId,
        status: CompanyMemberStatus.ACTIVE,
        ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
        roles: {
          some: {
            role: {
              companyId,
              key: OWNER_ROLE_KEY,
              deletedAt: null,
            },
          },
        },
      },
    });
  }

  async memberHasOwnerRole(
    tx: Prisma.TransactionClient,
    companyId: string,
    companyMemberId: string,
  ): Promise<boolean> {
    const assignment = await tx.companyMemberRole.findFirst({
      where: {
        companyMemberId,
        role: {
          companyId,
          key: OWNER_ROLE_KEY,
          deletedAt: null,
        },
      },
      select: { roleId: true },
    });

    return Boolean(assignment);
  }
}
