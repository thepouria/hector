import { Injectable } from '@nestjs/common';
import {
  CompanyMemberStatus,
  OWNER_ROLE_KEY,
  Prisma,
} from '@hector/database';
import { buildPaginationMeta, type PaginationMeta } from '../../common/dto/pagination-query.dto';
import { ERROR_CODES } from '../../common/constants';
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
import {
  buildMemberRolesSnapshot,
  buildRoleMetadataSnapshot,
  buildRolePermissionsSnapshot,
  buildRoleSnapshot,
} from '../audit/serializers/audit-snapshots';
import { CompanyContextService } from '../companies/company-context.service';
import type { CompanyContext } from '../companies/types/company.types';
import { AuthorizationService } from './authorization.service';
import type {
  CreateRoleDto,
  ListRolesQueryDto,
  ReplaceRolePermissionsDto,
  UpdateRoleDto,
} from './dto/roles.dto';
import { RBAC_ERROR_MESSAGES, ROLE_KEY_PATTERN } from './rbac.constants';

export type RolePermissionView = {
  id: string;
  key: string;
};

export type RoleView = {
  id: string;
  name: string;
  key: string;
  description: string | null;
  isSystem: boolean;
  permissions: RolePermissionView[];
};

@Injectable()
export class RolesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authorizationService: AuthorizationService,
    private readonly companyContextService: CompanyContextService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListRolesQueryDto,
  ): Promise<{ data: RoleView[]; meta: PaginationMeta }> {
    const where: Prisma.RoleWhereInput = {
      companyId: company.companyId,
      deletedAt: null,
    };

    if (query.isSystem !== undefined) {
      where.isSystem = query.isSystem;
    }

    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (query.page - 1) * query.pageSize;

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.role.count({ where }),
      this.database.client.role.findMany({
        where,
        include: this.roleInclude(),
        orderBy: [{ isSystem: 'desc' }, { key: 'asc' }],
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toRoleView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getById(company: CompanyContext, roleId: string): Promise<RoleView> {
    const role = await this.findCompanyRole(company.companyId, roleId);
    return this.toRoleView(role);
  }

  async create(company: CompanyContext, dto: CreateRoleDto): Promise<RoleView> {
    if (!ROLE_KEY_PATTERN.test(dto.key)) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: RBAC_ERROR_MESSAGES.INVALID_ROLE_KEY,
        statusCode: 400,
      });
    }

    const permissionIds = [...new Set(dto.permissionIds ?? [])];

    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        if (permissionIds.length > 0) {
          await this.assertPermissionsExist(tx, permissionIds);
          await this.assertActorMayComposePermissions(company, permissionIds, tx);
        }

        const existing = await tx.role.findUnique({
          where: {
            companyId_key: {
              companyId: company.companyId,
              key: dto.key,
            },
          },
        });

        if (existing && existing.deletedAt === null) {
          throw new AppError({
            code: ERROR_CODES.ROLE_ALREADY_EXISTS,
            message: RBAC_ERROR_MESSAGES.ROLE_ALREADY_EXISTS,
            statusCode: 409,
          });
        }

        if (existing && existing.deletedAt !== null) {
          throw new AppError({
            code: ERROR_CODES.ROLE_ALREADY_EXISTS,
            message: RBAC_ERROR_MESSAGES.ROLE_ALREADY_EXISTS,
            statusCode: 409,
          });
        }

        const created = await tx.role.create({
          data: {
            companyId: company.companyId,
            name: dto.name.trim(),
            key: dto.key,
            description: dto.description?.trim() || null,
            isSystem: false,
            permissions:
              permissionIds.length > 0
                ? {
                    create: permissionIds.map((permissionId) => ({ permissionId })),
                  }
                : undefined,
          },
          include: this.roleInclude(),
        });

        const view = this.toRoleView(created);
        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ROLE_CREATED,
          entityType: AUDIT_ENTITY_TYPES.ROLE,
          entityId: view.id,
          before: null,
          after: buildRoleSnapshot({
            id: view.id,
            name: view.name,
            key: view.key,
            description: view.description,
            isSystem: view.isSystem,
            permissions: view.permissions.map((permission) => permission.key),
          }),
        });

        if (audited) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.ROLE_CREATED,
              payload: {
                roleId: view.id,
                key: view.key,
              },
            }),
          );
        }

        return view;
      }),
    );
  }

  async update(company: CompanyContext, roleId: string, dto: UpdateRoleDto): Promise<RoleView> {
    if (dto.name === undefined && dto.description === undefined) {
      throw AppError.validation('At least one field is required to update the role.');
    }

    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        const role = await this.findCompanyRoleTx(tx, company.companyId, roleId);

        if (role.isSystem) {
          throw new AppError({
            code: ERROR_CODES.ROLE_SYSTEM_PROTECTED,
            message: RBAC_ERROR_MESSAGES.ROLE_SYSTEM_PROTECTED,
            statusCode: 403,
          });
        }

        const before = buildRoleMetadataSnapshot({
          name: role.name,
          description: role.description,
        });

        const updated = await tx.role.update({
          where: { id: role.id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined
              ? { description: dto.description.trim() || null }
              : {}),
          },
          include: this.roleInclude(),
        });

        const view = this.toRoleView(updated);
        const after = buildRoleMetadataSnapshot({
          name: view.name,
          description: view.description,
        });
        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ROLE_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.ROLE,
          entityId: view.id,
          before,
          after,
        });

        if (audited) {
          const beforeRecord = before as Record<string, unknown>;
          const afterRecord = after as Record<string, unknown>;
          const changedFields = Object.keys(beforeRecord).filter(
            (key) => !auditSnapshotsEqual(beforeRecord[key], afterRecord[key]),
          );
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.ROLE_UPDATED,
              payload: {
                roleId: view.id,
                changedFields,
              },
            }),
          );
        }

        return view;
      }),
    );
  }

  async replacePermissions(
    company: CompanyContext,
    roleId: string,
    dto: ReplaceRolePermissionsDto,
  ): Promise<RoleView> {
    const permissionIds = [...new Set(dto.permissionIds)];

    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        const role = await this.findCompanyRoleTx(tx, company.companyId, roleId);

        if (role.isSystem) {
          throw new AppError({
            code: ERROR_CODES.ROLE_SYSTEM_PROTECTED,
            message: RBAC_ERROR_MESSAGES.ROLE_SYSTEM_PROTECTED,
            statusCode: 403,
          });
        }

        await this.assertPermissionsExist(tx, permissionIds);
        await this.assertActorMayComposePermissions(company, permissionIds, tx);

        const previousPermissionKeys = [
          ...role.permissions.map((assignment) => assignment.permission.key),
        ].sort();
        const beforePermissions = buildRolePermissionsSnapshot(previousPermissionKeys);

        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        if (permissionIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              roleId: role.id,
              permissionId,
            })),
          });
        }

        const updated = await tx.role.findUniqueOrThrow({
          where: { id: role.id },
          include: this.roleInclude(),
        });

        const view = this.toRoleView(updated);
        const newPermissionKeys = view.permissions.map((permission) => permission.key).sort();
        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ROLE_PERMISSIONS_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.ROLE,
          entityId: view.id,
          before: beforePermissions,
          after: buildRolePermissionsSnapshot(newPermissionKeys),
        });

        if (audited) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.ROLE_PERMISSIONS_CHANGED,
              payload: {
                roleId: view.id,
                previousPermissionKeys,
                newPermissionKeys,
              },
            }),
          );
        }

        return view;
      }),
    );
  }

  async softDelete(company: CompanyContext, roleId: string): Promise<{ success: true }> {
    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        const role = await this.findCompanyRoleTx(tx, company.companyId, roleId);

        if (role.isSystem) {
          throw new AppError({
            code: ERROR_CODES.ROLE_SYSTEM_PROTECTED,
            message: RBAC_ERROR_MESSAGES.ROLE_SYSTEM_PROTECTED,
            statusCode: 403,
          });
        }

        const assignmentCount = await tx.companyMemberRole.count({
          where: {
            roleId: role.id,
            companyMember: {
              status: {
                in: [CompanyMemberStatus.ACTIVE, CompanyMemberStatus.SUSPENDED],
              },
            },
          },
        });

        if (assignmentCount > 0) {
          throw new AppError({
            code: ERROR_CODES.ROLE_IN_USE,
            message: RBAC_ERROR_MESSAGES.ROLE_IN_USE,
            statusCode: 409,
          });
        }

        const before = buildRoleSnapshot({
          id: role.id,
          name: role.name,
          key: role.key,
          description: role.description,
          isSystem: role.isSystem,
          permissions: role.permissions.map((assignment) => assignment.permission.key),
          deletedAt: null,
        });

        const deletedAt = new Date();
        await tx.role.update({
          where: { id: role.id },
          data: { deletedAt },
        });

        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.ROLE_DELETED,
          entityType: AUDIT_ENTITY_TYPES.ROLE,
          entityId: role.id,
          before,
          after: {
            deleted: true,
            deletedAt: deletedAt.toISOString(),
          },
        });

        if (audited) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.ROLE_DELETED,
              payload: {
                roleId: role.id,
                key: role.key,
              },
            }),
          );
        }

        return { success: true as const };
      }),
    );
  }

  /**
   * Replace member roles with escalation + OWNER + last-owner protections.
   */
  async replaceMemberRoles(
    company: CompanyContext,
    memberId: string,
    roleIds: string[],
  ): Promise<{
    id: string;
    status: string;
    joinedAt: Date;
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
    };
    roles: Array<{ id: string; key: string; name: string }>;
  }> {
    const uniqueRoleIds = [...new Set(roleIds)];

    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        const member = await tx.companyMember.findFirst({
          where: {
            id: memberId,
            companyId: company.companyId,
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        });

        if (!member) {
          throw new AppError({
            code: ERROR_CODES.MEMBER_NOT_FOUND,
            message: 'Member not found.',
            statusCode: 404,
          });
        }

        if (member.status === CompanyMemberStatus.REMOVED) {
          throw new AppError({
            code: ERROR_CODES.MEMBERSHIP_REMOVED,
            message: 'Membership has been removed.',
            statusCode: 409,
          });
        }

        const roles = await tx.role.findMany({
          where: {
            id: { in: uniqueRoleIds },
            deletedAt: null,
          },
          select: {
            id: true,
            key: true,
            name: true,
            companyId: true,
          },
        });

        if (roles.length !== uniqueRoleIds.length) {
          throw new AppError({
            code: ERROR_CODES.ROLE_NOT_FOUND,
            message: RBAC_ERROR_MESSAGES.ROLE_NOT_FOUND,
            statusCode: 404,
          });
        }

        const foreign = roles.find((role) => role.companyId !== company.companyId);
        if (foreign) {
          throw new AppError({
            code: ERROR_CODES.INVALID_COMPANY_ROLE,
            message: 'One or more roles do not belong to the current company.',
            statusCode: 400,
          });
        }

        const nextHasOwner = roles.some((role) => role.key === OWNER_ROLE_KEY);
        const currentlyOwner = await this.companyContextService.memberHasOwnerRole(
          tx,
          company.companyId,
          member.id,
        );
        const actorIsOwner = await this.companyContextService.memberHasOwnerRole(
          tx,
          company.companyId,
          company.companyMemberId,
        );

        if (nextHasOwner !== currentlyOwner && !actorIsOwner) {
          throw new AppError({
            code: ERROR_CODES.OWNER_REQUIRED,
            message: RBAC_ERROR_MESSAGES.OWNER_REQUIRED,
            statusCode: 403,
          });
        }

        if (currentlyOwner && !nextHasOwner) {
          const otherOwners = await this.companyContextService.countActiveOwners(
            tx,
            company.companyId,
            member.id,
          );
          if (otherOwners === 0) {
            throw new AppError({
              code: ERROR_CODES.LAST_OWNER_REQUIRED,
              message: RBAC_ERROR_MESSAGES.LAST_OWNER_REQUIRED,
              statusCode: 409,
            });
          }
        }

        // Permission-subset escalation rule (OWNER may assign anything).
        if (!actorIsOwner) {
          const actorPermissions = new Set(
            await this.authorizationService.getEffectivePermissions(company.companyMemberId),
          );
          const targetPermissions = await this.authorizationService.getRolePermissionKeys(
            tx,
            uniqueRoleIds,
          );
          if (!this.authorizationService.isPermissionSubset(actorPermissions, targetPermissions)) {
            throw new AppError({
              code: ERROR_CODES.ROLE_PERMISSION_ESCALATION,
              message: RBAC_ERROR_MESSAGES.ROLE_PERMISSION_ESCALATION,
              statusCode: 403,
            });
          }
        }

        const currentAssignments = await tx.companyMemberRole.findMany({
          where: {
            companyMemberId: member.id,
            role: { deletedAt: null },
          },
          include: {
            role: {
              select: { id: true, key: true },
            },
          },
        });
        const previousRoleIds = [...currentAssignments.map((a) => a.role.id)].sort();
        const beforeRoles = buildMemberRolesSnapshot(
          currentAssignments.map((assignment) => ({
            id: assignment.role.id,
            key: assignment.role.key,
          })),
        );

        await tx.companyMemberRole.deleteMany({
          where: { companyMemberId: member.id },
        });
        await tx.companyMemberRole.createMany({
          data: roles.map((role) => ({
            companyMemberId: member.id,
            roleId: role.id,
          })),
        });

        const newRoleIds = [...roles.map((role) => role.id)].sort();
        const afterRoles = buildMemberRolesSnapshot(
          roles.map((role) => ({ id: role.id, key: role.key })),
        );

        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.MEMBER_ROLES_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.COMPANY_MEMBER,
          entityId: member.id,
          before: beforeRoles,
          after: afterRoles,
        });

        if (audited) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.MEMBER_ROLES_CHANGED,
              payload: {
                memberId: member.id,
                previousRoleIds,
                newRoleIds,
              },
            }),
          );
        }

        return {
          id: member.id,
          status: member.status,
          joinedAt: member.joinedAt,
          user: member.user,
          roles: roles
            .map((role) => ({ id: role.id, key: role.key, name: role.name }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        };
      }),
    );
  }

  private async assertActorMayComposePermissions(
    company: CompanyContext,
    permissionIds: string[],
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const actorIsOwner = await this.companyContextService.memberHasOwnerRole(
      tx,
      company.companyId,
      company.companyMemberId,
    );
    if (actorIsOwner) {
      return;
    }

    const permissions = await tx.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { key: true },
    });
    const actorPermissions = new Set(
      await this.authorizationService.getEffectivePermissions(company.companyMemberId),
    );
    const candidate = new Set(permissions.map((permission) => permission.key));
    if (!this.authorizationService.isPermissionSubset(actorPermissions, candidate)) {
      throw new AppError({
        code: ERROR_CODES.ROLE_PERMISSION_ESCALATION,
        message: RBAC_ERROR_MESSAGES.ROLE_PERMISSION_ESCALATION,
        statusCode: 403,
      });
    }
  }

  private async assertPermissionsExist(
    tx: Prisma.TransactionClient,
    permissionIds: string[],
  ): Promise<void> {
    if (permissionIds.length === 0) {
      return;
    }

    const count = await tx.permission.count({
      where: { id: { in: permissionIds } },
    });

    if (count !== permissionIds.length) {
      throw new AppError({
        code: ERROR_CODES.PERMISSION_NOT_FOUND,
        message: RBAC_ERROR_MESSAGES.PERMISSION_NOT_FOUND,
        statusCode: 404,
      });
    }
  }

  private async findCompanyRole(companyId: string, roleId: string) {
    const role = await this.database.client.role.findFirst({
      where: {
        id: roleId,
        companyId,
        deletedAt: null,
      },
      include: this.roleInclude(),
    });

    if (!role) {
      throw new AppError({
        code: ERROR_CODES.ROLE_NOT_FOUND,
        message: RBAC_ERROR_MESSAGES.ROLE_NOT_FOUND,
        statusCode: 404,
      });
    }

    return role;
  }

  private async findCompanyRoleTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    roleId: string,
  ) {
    const role = await tx.role.findFirst({
      where: {
        id: roleId,
        companyId,
        deletedAt: null,
      },
      include: this.roleInclude(),
    });

    if (!role) {
      throw new AppError({
        code: ERROR_CODES.ROLE_NOT_FOUND,
        message: RBAC_ERROR_MESSAGES.ROLE_NOT_FOUND,
        statusCode: 404,
      });
    }

    return role;
  }

  private roleInclude() {
    return {
      permissions: {
        include: {
          permission: {
            select: {
              id: true,
              key: true,
            },
          },
        },
        orderBy: {
          permission: {
            key: 'asc' as const,
          },
        },
      },
    } satisfies Prisma.RoleInclude;
  }

  private toRoleView(role: {
    id: string;
    name: string;
    key: string;
    description: string | null;
    isSystem: boolean;
    permissions: Array<{ permission: { id: string; key: string } }>;
  }): RoleView {
    return {
      id: role.id,
      name: role.name,
      key: role.key,
      description: role.description,
      isSystem: role.isSystem,
      permissions: role.permissions.map((assignment) => ({
        id: assignment.permission.id,
        key: assignment.permission.key,
      })),
    };
  }
}
