import { Injectable } from '@nestjs/common';
import {
  CompanyMemberStatus,
  OWNER_ROLE_KEY,
  type PermissionKey,
  Prisma,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { RBAC_ERROR_MESSAGES } from './rbac.constants';

@Injectable()
export class AuthorizationService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Effective permissions = union of permissions from non-deleted roles
   * assigned to an ACTIVE membership.
   */
  async getEffectivePermissions(companyMemberId: string): Promise<PermissionKey[]> {
    const member = await this.database.client.companyMember.findUnique({
      where: { id: companyMemberId },
      select: { status: true },
    });

    if (!member || member.status !== CompanyMemberStatus.ACTIVE) {
      return [];
    }

    const rows = await this.database.client.rolePermission.findMany({
      where: {
        role: {
          deletedAt: null,
          members: {
            some: {
              companyMemberId,
            },
          },
        },
      },
      select: {
        permission: {
          select: { key: true },
        },
      },
    });

    const keys = new Set<string>();
    for (const row of rows) {
      keys.add(row.permission.key);
    }

    return [...keys].sort() as PermissionKey[];
  }

  async hasAllPermissions(
    companyMemberId: string,
    required: readonly PermissionKey[],
  ): Promise<boolean> {
    if (required.length === 0) {
      return true;
    }

    const effective = new Set(await this.getEffectivePermissions(companyMemberId));
    return required.every((permission) => effective.has(permission));
  }

  async assertHasAllPermissions(
    companyMemberId: string,
    required: readonly PermissionKey[],
  ): Promise<void> {
    const allowed = await this.hasAllPermissions(companyMemberId, required);
    if (!allowed) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: RBAC_ERROR_MESSAGES.FORBIDDEN,
        statusCode: 403,
      });
    }
  }

  async memberHasOwnerRole(companyId: string, companyMemberId: string): Promise<boolean> {
    const assignment = await this.database.client.companyMemberRole.findFirst({
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

  async assertIsOwner(companyId: string, companyMemberId: string): Promise<void> {
    const isOwner = await this.memberHasOwnerRole(companyId, companyMemberId);
    if (!isOwner) {
      throw new AppError({
        code: ERROR_CODES.OWNER_REQUIRED,
        message: RBAC_ERROR_MESSAGES.OWNER_REQUIRED,
        statusCode: 403,
      });
    }
  }

  async getMemberRoles(companyMemberId: string): Promise<
    Array<{
      id: string;
      key: string;
      name: string;
    }>
  > {
    const assignments = await this.database.client.companyMemberRole.findMany({
      where: {
        companyMemberId,
        role: {
          deletedAt: null,
        },
      },
      include: {
        role: {
          select: {
            id: true,
            key: true,
            name: true,
          },
        },
      },
      orderBy: {
        role: {
          key: 'asc',
        },
      },
    });

    return assignments.map((assignment) => ({
      id: assignment.role.id,
      key: assignment.role.key,
      name: assignment.role.name,
    }));
  }

  /**
   * Returns true when `candidate` permissions are a subset of `actor` permissions.
   */
  isPermissionSubset(
    actorPermissions: ReadonlySet<string>,
    candidatePermissions: ReadonlySet<string>,
  ): boolean {
    for (const permission of candidatePermissions) {
      if (!actorPermissions.has(permission)) {
        return false;
      }
    }
    return true;
  }

  async getRolePermissionKeys(
    tx: Prisma.TransactionClient | DatabaseService['client'],
    roleIds: string[],
  ): Promise<Set<string>> {
    if (roleIds.length === 0) {
      return new Set();
    }

    const rows = await tx.rolePermission.findMany({
      where: {
        roleId: { in: roleIds },
        role: { deletedAt: null },
      },
      select: {
        permission: { select: { key: true } },
      },
    });

    return new Set(rows.map((row) => row.permission.key));
  }
}
