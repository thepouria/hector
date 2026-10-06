import { Inject, Injectable, forwardRef } from '@nestjs/common';
import {
  CompanyMemberStatus,
  OWNER_ROLE_KEY,
  Prisma,
  UserStatus,
} from '@hector/database';
import { buildPaginationMeta, type PaginationMeta } from '../../../common/dto/pagination-query.dto';
import { ERROR_CODES } from '../../../common/constants';
import { AppError } from '../../../common/exceptions/app.error';
import { DatabaseService } from '../../../infrastructure/database/database.service';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  DomainEventFactory,
  commitThenPublish,
} from '../../../infrastructure/events';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../audit/audit.constants';
import { AuditService } from '../../audit/audit.service';
import {
  buildMemberSnapshot,
  buildMemberStatusSnapshot,
} from '../../audit/serializers/audit-snapshots';
import { AuthorizationService } from '../../rbac/authorization.service';
import { RBAC_ERROR_MESSAGES } from '../../rbac/rbac.constants';
import {
  COMPANY_ERROR_MESSAGES,
  type MemberSortField,
} from '../companies.constants';
import { CompanyContextService } from '../company-context.service';
import type { CreateMemberDto } from '../dto/create-member.dto';
import type { ListMembersQueryDto } from '../dto/list-members-query.dto';
import type { UpdateMemberDto } from '../dto/update-member.dto';
import type { CompanyContext, MemberView } from '../types/company.types';

type MemberWithRelations = Prisma.CompanyMemberGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        email: true;
        firstName: true;
        lastName: true;
        passwordHash: false;
      };
    };
    roles: {
      include: {
        role: {
          select: {
            id: true;
            key: true;
            name: true;
            deletedAt: true;
          };
        };
      };
    };
  };
}>;

@Injectable()
export class MembersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContextService: CompanyContextService,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  async list(
    company: CompanyContext,
    query: ListMembersQueryDto,
  ): Promise<{ data: MemberView[]; meta: PaginationMeta }> {
    const where = this.buildListWhere(company.companyId, query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);
    const skip = (query.page - 1) * query.pageSize;

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.companyMember.count({ where }),
      this.database.client.companyMember.findMany({
        where,
        include: this.memberInclude(),
        orderBy,
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toMemberView(row)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async getById(company: CompanyContext, memberId: string): Promise<MemberView> {
    const member = await this.findScopedMember(company.companyId, memberId);
    return this.toMemberView(member);
  }

  async create(company: CompanyContext, dto: CreateMemberDto): Promise<MemberView> {
    const email = dto.email.trim().toLowerCase();

    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        const user = await tx.user.findFirst({
          where: {
            email,
            deletedAt: null,
            status: UserStatus.ACTIVE,
          },
          select: { id: true },
        });

        if (!user) {
          throw new AppError({
            code: ERROR_CODES.USER_NOT_FOUND,
            message: COMPANY_ERROR_MESSAGES.USER_NOT_FOUND,
            statusCode: 404,
          });
        }

        const roles = await this.loadCompanyRoles(tx, company.companyId, dto.roleIds);

        const actorIsOwner = await this.companyContextService.memberHasOwnerRole(
          tx,
          company.companyId,
          company.companyMemberId,
        );
        const assignsOwner = roles.some((role) => role.key === OWNER_ROLE_KEY);
        if (assignsOwner && !actorIsOwner) {
          throw new AppError({
            code: ERROR_CODES.OWNER_REQUIRED,
            message: RBAC_ERROR_MESSAGES.OWNER_REQUIRED,
            statusCode: 403,
          });
        }

        if (!actorIsOwner) {
          const actorPermissions = new Set(
            await this.authorizationService.getEffectivePermissions(company.companyMemberId),
          );
          const targetPermissions = await this.authorizationService.getRolePermissionKeys(
            tx,
            roles.map((role) => role.id),
          );
          if (!this.authorizationService.isPermissionSubset(actorPermissions, targetPermissions)) {
            throw new AppError({
              code: ERROR_CODES.ROLE_PERMISSION_ESCALATION,
              message: RBAC_ERROR_MESSAGES.ROLE_PERMISSION_ESCALATION,
              statusCode: 403,
            });
          }
        }

        const existing = await tx.companyMember.findUnique({
          where: {
            companyId_userId: {
              companyId: company.companyId,
              userId: user.id,
            },
          },
        });

        if (existing && existing.status === CompanyMemberStatus.ACTIVE) {
          throw new AppError({
            code: ERROR_CODES.MEMBERSHIP_ALREADY_EXISTS,
            message: COMPANY_ERROR_MESSAGES.MEMBERSHIP_ALREADY_EXISTS,
            statusCode: 409,
          });
        }

        if (existing && existing.status === CompanyMemberStatus.SUSPENDED) {
          throw new AppError({
            code: ERROR_CODES.MEMBERSHIP_ALREADY_EXISTS,
            message: COMPANY_ERROR_MESSAGES.MEMBERSHIP_ALREADY_EXISTS,
            statusCode: 409,
          });
        }

        let memberId: string;
        let reactivated = false;

        if (existing && existing.status === CompanyMemberStatus.REMOVED) {
          // Reactivate existing historical membership; preserve original joinedAt.
          await tx.companyMember.update({
            where: { id: existing.id },
            data: { status: CompanyMemberStatus.ACTIVE },
          });
          await tx.companyMemberRole.deleteMany({
            where: { companyMemberId: existing.id },
          });
          memberId = existing.id;
          reactivated = true;
        } else {
          const created = await tx.companyMember.create({
            data: {
              companyId: company.companyId,
              userId: user.id,
              status: CompanyMemberStatus.ACTIVE,
            },
          });
          memberId = created.id;
        }

        await tx.companyMemberRole.createMany({
          data: roles.map((role) => ({
            companyMemberId: memberId,
            roleId: role.id,
          })),
        });

        const member = await tx.companyMember.findUniqueOrThrow({
          where: { id: memberId },
          include: this.memberInclude(),
        });

        const view = this.toMemberView(member);
        const roleIds = [...view.roles.map((role) => role.id)].sort();
        const audited = await this.auditService.record(tx, {
          action: reactivated ? AUDIT_ACTIONS.MEMBER_REACTIVATED : AUDIT_ACTIONS.MEMBER_CREATED,
          entityType: AUDIT_ENTITY_TYPES.COMPANY_MEMBER,
          entityId: view.id,
          before: reactivated
            ? buildMemberSnapshot({
                id: existing!.id,
                userId: existing!.userId,
                status: CompanyMemberStatus.REMOVED,
              })
            : null,
          after: buildMemberSnapshot({
            id: view.id,
            userId: view.user.id,
            status: view.status,
            roles: view.roles.map((role) => ({ id: role.id, key: role.key })),
          }),
        });

        if (audited) {
          events.push(
            this.eventFactory.create({
              type: reactivated
                ? DOMAIN_EVENTS.MEMBER_REACTIVATED
                : DOMAIN_EVENTS.MEMBER_CREATED,
              payload: {
                memberId: view.id,
                userId: view.user.id,
                roleIds,
              },
            }),
          );
        }

        return view;
      }),
    );
  }

  async updateStatus(
    company: CompanyContext,
    memberId: string,
    dto: UpdateMemberDto,
  ): Promise<MemberView> {
    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        const member = await this.findScopedMemberTx(tx, company.companyId, memberId);

        if (member.status === CompanyMemberStatus.REMOVED) {
          throw new AppError({
            code: ERROR_CODES.MEMBERSHIP_REMOVED,
            message: COMPANY_ERROR_MESSAGES.MEMBERSHIP_REMOVED,
            statusCode: 409,
          });
        }

        if (dto.status === CompanyMemberStatus.SUSPENDED) {
          await this.assertNotLastOwner(tx, company.companyId, member);
        }

        const beforeStatus = member.status;
        const updated = await tx.companyMember.update({
          where: { id: member.id },
          data: { status: dto.status },
          include: this.memberInclude(),
        });

        const view = this.toMemberView(updated);
        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.MEMBER_STATUS_CHANGED,
          entityType: AUDIT_ENTITY_TYPES.COMPANY_MEMBER,
          entityId: view.id,
          before: buildMemberStatusSnapshot(beforeStatus),
          after: buildMemberStatusSnapshot(view.status),
        });

        if (audited) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.MEMBER_STATUS_CHANGED,
              payload: {
                memberId: view.id,
                userId: view.user.id,
                previousStatus: beforeStatus,
                newStatus: view.status,
              },
            }),
          );
        }

        return view;
      }),
    );
  }

  async remove(company: CompanyContext, memberId: string): Promise<MemberView> {
    return commitThenPublish(this.eventBus, async (events) =>
      this.companyContextService.withCompanyLock(company.companyId, async (tx) => {
        const member = await this.findScopedMemberTx(tx, company.companyId, memberId);

        if (member.status === CompanyMemberStatus.REMOVED) {
          return this.toMemberView(member);
        }

        await this.assertNotLastOwner(tx, company.companyId, member);

        const before = buildMemberSnapshot({
          id: member.id,
          userId: (member.user as { id: string }).id,
          status: member.status,
          roles: member.roles
            .filter((assignment) => assignment.role.deletedAt === null)
            .map((assignment) => ({
              id: assignment.role.id,
              key: assignment.role.key,
            })),
        });

        const updated = await tx.companyMember.update({
          where: { id: member.id },
          data: { status: CompanyMemberStatus.REMOVED },
          include: this.memberInclude(),
        });

        const view = this.toMemberView(updated);
        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.MEMBER_REMOVED,
          entityType: AUDIT_ENTITY_TYPES.COMPANY_MEMBER,
          entityId: view.id,
          before,
          after: buildMemberSnapshot({
            id: view.id,
            userId: view.user.id,
            status: view.status,
            roles: view.roles.map((role) => ({ id: role.id, key: role.key })),
          }),
        });

        if (audited) {
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.MEMBER_REMOVED,
              payload: {
                memberId: view.id,
                userId: view.user.id,
              },
            }),
          );
        }

        return view;
      }),
    );
  }

  private async assertNotLastOwner(
    tx: Prisma.TransactionClient,
    companyId: string,
    member: { id: string; status: CompanyMemberStatus },
  ): Promise<void> {
    if (member.status !== CompanyMemberStatus.ACTIVE) {
      return;
    }

    const isOwner = await this.companyContextService.memberHasOwnerRole(tx, companyId, member.id);
    if (!isOwner) {
      return;
    }

    const otherOwners = await this.companyContextService.countActiveOwners(tx, companyId, member.id);
    if (otherOwners === 0) {
      throw new AppError({
        code: ERROR_CODES.LAST_OWNER_REQUIRED,
        message: COMPANY_ERROR_MESSAGES.LAST_OWNER_REQUIRED,
        statusCode: 409,
      });
    }
  }

  private async loadCompanyRoles(
    tx: Prisma.TransactionClient,
    companyId: string,
    roleIds: string[],
  ) {
    const uniqueRoleIds = [...new Set(roleIds)];
    const roles = await tx.role.findMany({
      where: {
        id: { in: uniqueRoleIds },
        deletedAt: null,
      },
      select: {
        id: true,
        key: true,
        companyId: true,
      },
    });

    if (roles.length !== uniqueRoleIds.length) {
      throw new AppError({
        code: ERROR_CODES.ROLE_NOT_FOUND,
        message: COMPANY_ERROR_MESSAGES.ROLE_NOT_FOUND,
        statusCode: 404,
      });
    }

    const foreign = roles.find((role) => role.companyId !== companyId);
    if (foreign) {
      throw new AppError({
        code: ERROR_CODES.INVALID_COMPANY_ROLE,
        message: COMPANY_ERROR_MESSAGES.INVALID_COMPANY_ROLE,
        statusCode: 400,
      });
    }

    return roles;
  }

  private async findScopedMember(companyId: string, memberId: string) {
    const member = await this.database.client.companyMember.findFirst({
      where: {
        id: memberId,
        companyId,
      },
      include: this.memberInclude(),
    });

    if (!member) {
      throw new AppError({
        code: ERROR_CODES.MEMBER_NOT_FOUND,
        message: COMPANY_ERROR_MESSAGES.MEMBER_NOT_FOUND,
        statusCode: 404,
      });
    }

    return member;
  }

  private async findScopedMemberTx(
    tx: Prisma.TransactionClient,
    companyId: string,
    memberId: string,
  ) {
    const member = await tx.companyMember.findFirst({
      where: {
        id: memberId,
        companyId,
      },
      include: this.memberInclude(),
    });

    if (!member) {
      throw new AppError({
        code: ERROR_CODES.MEMBER_NOT_FOUND,
        message: COMPANY_ERROR_MESSAGES.MEMBER_NOT_FOUND,
        statusCode: 404,
      });
    }

    return member;
  }

  private buildListWhere(
    companyId: string,
    query: ListMembersQueryDto,
  ): Prisma.CompanyMemberWhereInput {
    const where: Prisma.CompanyMemberWhereInput = {
      companyId,
    };

    if (query.status) {
      where.status = query.status;
    } else {
      // Default list focuses on active + suspended (still in company), not removed.
      where.status = {
        in: [CompanyMemberStatus.ACTIVE, CompanyMemberStatus.SUSPENDED],
      };
    }

    if (query.search?.trim()) {
      const search = query.search.trim();
      where.user = {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    return where;
  }

  private buildOrderBy(
    sortBy: MemberSortField,
    sortOrder: 'asc' | 'desc',
  ): Prisma.CompanyMemberOrderByWithRelationInput {
    if (sortBy === 'firstName') {
      return { user: { firstName: sortOrder } };
    }
    if (sortBy === 'lastName') {
      return { user: { lastName: sortOrder } };
    }
    return { joinedAt: sortOrder };
  }

  private memberInclude() {
    return {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      roles: {
        include: {
          role: {
            select: {
              id: true,
              key: true,
              name: true,
              deletedAt: true,
            },
          },
        },
      },
    } satisfies Prisma.CompanyMemberInclude;
  }

  private toMemberView(member: MemberWithRelations): MemberView {
    return {
      id: member.id,
      status: member.status,
      joinedAt: member.joinedAt,
      user: (() => {
        const user = member.user as {
          id: string;
          email: string;
          firstName: string;
          lastName: string;
        };
        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        };
      })(),
      roles: member.roles
        .filter((assignment) => assignment.role.deletedAt === null)
        .map((assignment) => ({
          id: assignment.role.id,
          key: assignment.role.key,
          name: assignment.role.name,
        })),
    };
  }
}
