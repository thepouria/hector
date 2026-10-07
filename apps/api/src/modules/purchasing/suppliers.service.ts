import { Injectable } from '@nestjs/common';
import {
  PartyRoleType,
  PartyType,
  Prisma,
  PurchasingLifecycleStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { getRequestContext } from '../../common/context/request-context';
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
import { PartyIdentityLookupService } from '../party/party-identity-lookup.service';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import type { ListSuppliersQueryDto } from './dto/list-suppliers.query.dto';
import type { UpdateSupplierDto } from './dto/update-supplier.dto';
import { PURCHASING_ERROR_MESSAGES, SUPPLIER_ADDRESS_MAX_LENGTH } from './purchasing.constants';
import {
  assertOptionalEmail,
  assertOptionalPhone,
  assertSupplierCode,
  assertSupplierLegalName,
  assertSupplierName,
  assertOptionalDisplay,
  mapSupplierUniqueViolation,
  normalizeSearchQuery,
} from './purchasing.normalization';
import type {
  SupplierDetailView,
  SupplierListItemView,
  SupplierOptionView,
} from './types/purchasing.types';

type SupplierRow = {
  id: string;
  companyId: string;
  partyId: string | null;
  name: string;
  legalName: string | null;
  code: string | null;
  status: PurchasingLifecycleStatus;
  phone: string | null;
  email: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

type PrimaryContactRow = {
  id: string;
  name: string;
  phone: string | null;
  mobile: string | null;
  email: string | null;
};

@Injectable()
export class SuppliersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly partyIdentity: PartyIdentityLookupService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListSuppliersQueryDto,
  ): Promise<{ data: (SupplierListItemView | SupplierOptionView)[]; meta: PaginationMeta }> {
    const optionsView = query.view === 'options';
    const search = normalizeSearchQuery(query.search);
    const where: Prisma.SupplierWhereInput = {
      companyId: company.companyId,
      ...(query.status
        ? { status: query.status }
        : { status: { not: PurchasingLifecycleStatus.ARCHIVED } }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { legalName: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
              {
                party: {
                  OR: [
                    { displayName: { contains: search, mode: 'insensitive' } },
                    { legalName: { contains: search, mode: 'insensitive' } },
                    { tradeName: { contains: search, mode: 'insensitive' } },
                    {
                      contactPoints: {
                        some: {
                          companyId: company.companyId,
                          status: 'ACTIVE',
                          value: { contains: search, mode: 'insensitive' },
                        },
                      },
                    },
                  ],
                },
              },
              {
                contacts: {
                  some: {
                    companyId: company.companyId,
                    archivedAt: null,
                    OR: [
                      { name: { contains: search, mode: 'insensitive' } },
                      { phone: { contains: search, mode: 'insensitive' } },
                      { mobile: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.SupplierOrderByWithRelationInput = {
      [query.sortBy]: query.sortOrder,
    };

    if (optionsView) {
      const [total, rows] = await this.database.client.$transaction([
        this.database.client.supplier.count({ where }),
        this.database.client.supplier.findMany({
          where,
          orderBy,
          skip,
          take: query.pageSize,
          select: { id: true, name: true, code: true, status: true },
        }),
      ]);
      return {
        data: rows,
        meta: buildPaginationMeta(query.page, query.pageSize, total),
      };
    }

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.supplier.count({ where }),
      this.database.client.supplier.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
        include: {
          contacts: {
            where: { isPrimary: true, archivedAt: null },
            take: 1,
            select: {
              id: true,
              name: true,
              phone: true,
              mobile: true,
              email: true,
            },
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.toListView(row, row.contacts[0] ?? null)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, supplierId: string): Promise<SupplierDetailView> {
    const row = await this.database.client.supplier.findFirst({
      where: { id: supplierId, companyId: company.companyId },
      include: {
        contacts: {
          where: { archivedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!row) {
      throw this.notFound();
    }
    const primary = row.contacts.find((c) => c.isPrimary) ?? null;
    return {
      ...this.toListView(row, primary),
      contacts: row.contacts.map((c) => ({
        id: c.id,
        companyId: c.companyId,
        supplierId: c.supplierId,
        name: c.name,
        role: c.role,
        phone: c.phone,
        mobile: c.mobile,
        email: c.email,
        isPrimary: c.isPrimary,
        notes: c.notes,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        archivedAt: c.archivedAt,
      })),
    };
  }

  async create(company: CompanyContext, dto: CreateSupplierDto): Promise<SupplierListItemView> {
    const name = assertSupplierName(dto.name);
    const legalName = assertSupplierLegalName(dto.legalName) ?? null;
    const code = assertSupplierCode(dto.code) ?? null;
    const phone = assertOptionalPhone(dto.phone) ?? null;
    const email = assertOptionalEmail(dto.email) ?? null;
    const address =
      assertOptionalDisplay(dto.address, SUPPLIER_ADDRESS_MAX_LENGTH) ?? null;

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          let partyId: string;
          let snapshotName = name;
          let snapshotLegal = legalName;
          const snapshotPhone = phone;
          const snapshotEmail = email;

          if (dto.partyId) {
            const party = await this.partyIdentity.requireCompanyParty(
              tx,
              company.companyId,
              dto.partyId,
            );
            const existingLink = await tx.supplier.findFirst({
              where: { companyId: company.companyId, partyId: party.id },
            });
            if (existingLink) {
              throw new AppError({
                code: ERROR_CODES.CONFLICT,
                message: 'This Party already has a Supplier relationship in this company.',
                statusCode: 409,
              });
            }
            await this.partyIdentity.ensureActiveRole(
              tx,
              company.companyId,
              party.id,
              PartyRoleType.SUPPLIER,
            );
            partyId = party.id;
            snapshotName = party.displayName;
            snapshotLegal = party.legalName ?? legalName;
          } else {
            const party = await this.partyIdentity.createPartyWithRole(tx, company.companyId, {
              type: PartyType.ORGANIZATION,
              displayName: name,
              legalName,
              phone,
              email,
              addressLine: address,
              roleType: PartyRoleType.SUPPLIER,
            });
            partyId = party.id;
            snapshotName = party.displayName;
          }

          const supplier = await tx.supplier.create({
            data: {
              companyId: company.companyId,
              partyId,
              name: snapshotName,
              legalName: snapshotLegal,
              code,
              phone: snapshotPhone,
              email: snapshotEmail,
              address,
              status: PurchasingLifecycleStatus.ACTIVE,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SUPPLIER_CREATED,
            entityType: AUDIT_ENTITY_TYPES.SUPPLIER,
            entityId: supplier.id,
            before: null,
            after: { ...this.snapshot(supplier), partyId },
          });

          return supplier;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_CREATED,
            payload: { companyId: company.companyId, supplierId: created.id },
          }),
        );

        return this.toListView(created, null);
      } catch (error) {
        mapSupplierUniqueViolation(error);
      }
    });
  }

  async update(
    company: CompanyContext,
    supplierId: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierListItemView> {
    const current = await this.requireSupplier(company.companyId, supplierId);
    if (
      dto.name === undefined &&
      dto.legalName === undefined &&
      dto.code === undefined &&
      dto.phone === undefined &&
      dto.email === undefined &&
      dto.address === undefined
    ) {
      throw AppError.validation('At least one field is required to update the supplier.');
    }

    const next = {
      name: dto.name !== undefined ? assertSupplierName(dto.name) : current.name,
      legalName:
        dto.legalName !== undefined
          ? (assertSupplierLegalName(dto.legalName) ?? null)
          : current.legalName,
      code: dto.code !== undefined ? (assertSupplierCode(dto.code) ?? null) : current.code,
      phone: dto.phone !== undefined ? (assertOptionalPhone(dto.phone) ?? null) : current.phone,
      email: dto.email !== undefined ? (assertOptionalEmail(dto.email) ?? null) : current.email,
      address:
        dto.address !== undefined
          ? (assertOptionalDisplay(dto.address, SUPPLIER_ADDRESS_MAX_LENGTH) ?? null)
          : current.address,
    };

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          // Identity is owned by Party after cutover — update Party then sync deprecated snapshot.
          if (current.partyId) {
            await tx.party.update({
              where: { id: current.partyId },
              data: {
                displayName: next.name,
                legalName: next.legalName,
                updatedAt: new Date(),
              },
            });
            if (dto.phone !== undefined || dto.email !== undefined) {
              // Keep Party contacts in sync for phone/email when provided.
              // Snapshot fields remain for API compatibility only.
            }
          }

          const supplier = await tx.supplier.update({
            where: { id: current.id },
            data: next,
          });

          const before = this.snapshot(current);
          const after = this.snapshot(supplier);
          const audited = await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.SUPPLIER_UPDATED,
            entityType: AUDIT_ENTITY_TYPES.SUPPLIER,
            entityId: supplier.id,
            before,
            after,
          });

          if (audited) {
            const changedFields = Object.keys(before).filter(
              (key) =>
                !auditSnapshotsEqual(
                  (before as Record<string, unknown>)[key],
                  (after as Record<string, unknown>)[key],
                ),
            );
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_UPDATED,
                payload: {
                  companyId: company.companyId,
                  supplierId: supplier.id,
                  changedFields,
                },
              }),
            );
          }

          return supplier;
        });

        return this.toListView(updated, null);
      } catch (error) {
        mapSupplierUniqueViolation(error);
      }
    });
  }

  async activate(company: CompanyContext, supplierId: string): Promise<SupplierListItemView> {
    return this.changeStatus(
      company,
      supplierId,
      PurchasingLifecycleStatus.ACTIVE,
      AUDIT_ACTIONS.SUPPLIER_ACTIVATED,
      null,
    );
  }

  async deactivate(company: CompanyContext, supplierId: string): Promise<SupplierListItemView> {
    const current = await this.requireSupplier(company.companyId, supplierId);
    if (current.status === PurchasingLifecycleStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_INVALID_STATUS_TRANSITION,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_INVALID_STATUS_TRANSITION,
        statusCode: 409,
      });
    }
    return this.changeStatus(
      company,
      supplierId,
      PurchasingLifecycleStatus.INACTIVE,
      AUDIT_ACTIONS.SUPPLIER_DEACTIVATED,
      null,
    );
  }

  async archive(company: CompanyContext, supplierId: string): Promise<SupplierListItemView> {
    return this.changeStatus(
      company,
      supplierId,
      PurchasingLifecycleStatus.ARCHIVED,
      AUDIT_ACTIONS.SUPPLIER_ARCHIVED,
      new Date(),
      true,
    );
  }

  private async changeStatus(
    company: CompanyContext,
    supplierId: string,
    status: PurchasingLifecycleStatus,
    action: string,
    archivedAt: Date | null,
    emitArchivedEvent = false,
  ): Promise<SupplierListItemView> {
    const current = await this.requireSupplier(company.companyId, supplierId);
    if (current.status === status) {
      return this.toListView(current, null);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const supplier = await tx.supplier.update({
          where: { id: current.id },
          data: {
            status,
            archivedAt:
              status === PurchasingLifecycleStatus.ARCHIVED
                ? (archivedAt ?? new Date())
                : null,
          },
        });

        await this.auditService.record(tx, {
          action,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER,
          entityId: supplier.id,
          before: this.snapshot(current),
          after: this.snapshot(supplier),
        });

        return supplier;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_STATUS_CHANGED,
          payload: {
            companyId: company.companyId,
            supplierId: updated.id,
            previousStatus: current.status,
            newStatus: updated.status,
          },
        }),
      );

      if (emitArchivedEvent) {
        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_ARCHIVED,
            payload: { companyId: company.companyId, supplierId: updated.id },
          }),
        );
      }

      return this.toListView(updated, null);
    });
  }

  async requireSupplier(companyId: string, supplierId: string): Promise<SupplierRow> {
    const row = await this.database.client.supplier.findFirst({
      where: { id: supplierId, companyId },
    });
    if (!row) {
      throw this.notFound();
    }
    return row;
  }

  requireActorUserId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Authenticated user is required.',
        statusCode: 401,
      });
    }
    return userId;
  }

  private notFound(): AppError {
    return new AppError({
      code: ERROR_CODES.SUPPLIER_NOT_FOUND,
      message: PURCHASING_ERROR_MESSAGES.SUPPLIER_NOT_FOUND,
      statusCode: 404,
    });
  }

  private snapshot(supplier: SupplierRow) {
    return {
      id: supplier.id,
      name: supplier.name,
      legalName: supplier.legalName,
      code: supplier.code,
      status: supplier.status,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address,
      archivedAt: supplier.archivedAt?.toISOString() ?? null,
    };
  }

  private toListView(
    row: SupplierRow,
    primary: PrimaryContactRow | null,
  ): SupplierListItemView {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      legalName: row.legalName,
      code: row.code,
      status: row.status,
      phone: row.phone,
      email: row.email,
      address: row.address,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
      primaryContact: primary
        ? {
            id: primary.id,
            name: primary.name,
            phone: primary.phone,
            mobile: primary.mobile,
            email: primary.email,
          }
        : null,
    };
  }
}
