import { Injectable } from '@nestjs/common';
import { BarcodeType, CatalogLifecycleStatus, Prisma } from '@hector/database';
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
import type { CompanyContext } from '../companies/types/company.types';
import {
  CATALOG_ERROR_MESSAGES,
  INTERNAL_BARCODE_GENERATION_RETRIES,
} from './catalog.constants';
import { mapCatalogUniqueViolation } from './catalog-unique.error';
import { generateInternalBarcodeValue } from './barcode-internal.util';
import {
  detectBarcodeType,
  normalizeAndValidateBarcode,
  normalizeScannedValue,
} from './barcode-normalize.util';
import { skuInclude, toSkuView, type SkuRow } from './sku.mapper';
import type { CreateSkuBarcodeDto } from './dto/create-sku-barcode.dto';
import type {
  BarcodeLookupView,
  BarcodeView,
  ProductView,
  SkuView,
} from './types/catalog.types';

type BarcodeRow = {
  id: string;
  companyId: string;
  skuId: string;
  value: string;
  normalizedValue: string;
  type: BarcodeType;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

@Injectable()
export class BarcodesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
  ) {}

  /**
   * Exact operational scan resolution within the active company.
   * Archived barcodes → BARCODE_NOT_ACTIVE.
   * Returns SKU/Product identity + status (does not decide inventory eligibility).
   */
  async resolve(company: CompanyContext, rawValue: string): Promise<BarcodeLookupView> {
    const normalizedValue = normalizeScannedValue(rawValue);

    const barcode = await this.database.client.barcode.findFirst({
      where: {
        companyId: company.companyId,
        normalizedValue,
      },
      include: {
        sku: {
          include: {
            ...skuInclude,
            product: true,
          },
        },
      },
    });

    if (!barcode) {
      throw new AppError({
        code: ERROR_CODES.BARCODE_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.BARCODE_NOT_FOUND,
        statusCode: 404,
      });
    }

    if (barcode.archivedAt) {
      throw new AppError({
        code: ERROR_CODES.BARCODE_NOT_ACTIVE,
        message: CATALOG_ERROR_MESSAGES.BARCODE_NOT_ACTIVE,
        statusCode: 409,
      });
    }

    return {
      barcode: this.toBarcodeView(barcode),
      sku: this.toSkuView(barcode.sku),
      product: this.toProductView(barcode.sku.product),
    };
  }

  /** Soft type suggestion helper for UI (not authoritative). */
  detectType(rawValue: string) {
    return detectBarcodeType(rawValue);
  }

  async listForSku(company: CompanyContext, skuId: string): Promise<BarcodeView[]> {
    await this.requireSku(company, skuId);
    const rows = await this.database.client.barcode.findMany({
      where: { companyId: company.companyId, skuId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => this.toBarcodeView(r));
  }

  async get(company: CompanyContext, barcodeId: string): Promise<BarcodeView> {
    const row = await this.requireBarcode(company, barcodeId);
    return this.toBarcodeView(row);
  }

  async create(
    company: CompanyContext,
    skuId: string,
    dto: CreateSkuBarcodeDto,
  ): Promise<BarcodeView> {
    const sku = await this.requireSku(company, skuId);
    const type = dto.type ?? BarcodeType.OTHER;
    const normalized = normalizeAndValidateBarcode(dto.value, type);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const created = await this.database.client.$transaction(async (tx) => {
          const activeCount = await tx.barcode.count({
            where: { companyId: company.companyId, skuId: sku.id, archivedAt: null },
          });
          const makePrimary = dto.isPrimary === true || (dto.isPrimary !== false && activeCount === 0);
          let demotedRows: Array<{ id: string; value: string }> = [];

          if (makePrimary) {
            demotedRows = await tx.barcode.findMany({
              where: {
                skuId: sku.id,
                companyId: company.companyId,
                isPrimary: true,
                archivedAt: null,
              },
              select: { id: true, value: true },
            });
            await tx.barcode.updateMany({
              where: {
                skuId: sku.id,
                companyId: company.companyId,
                isPrimary: true,
                archivedAt: null,
              },
              data: { isPrimary: false },
            });
          }

          const barcode = await tx.barcode.create({
            data: {
              companyId: company.companyId,
              skuId: sku.id,
              value: normalized.value,
              normalizedValue: normalized.normalizedValue,
              type: normalized.type,
              isPrimary: makePrimary,
            },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.BARCODE_CREATED,
            entityType: AUDIT_ENTITY_TYPES.BARCODE,
            entityId: barcode.id,
            before: null,
            after: this.snapshot(barcode),
            metadata: {
              skuId: barcode.skuId,
              productId: sku.productId,
              type: barcode.type,
              value: barcode.value,
              ...(demotedRows.length > 0
                ? {
                    demotedBarcodeIds: demotedRows.map((row) => row.id),
                    demotedBarcodeValues: demotedRows.map((row) => row.value),
                    becamePrimary: true,
                  }
                : {}),
            },
          });

          return barcode;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_BARCODE_CREATED,
            payload: {
              companyId: company.companyId,
              productId: sku.productId,
              skuId: created.skuId,
              barcodeId: created.id,
            },
          }),
        );

        return this.toBarcodeView(created);
      } catch (error) {
        this.mapBarcodeWriteError(error);
      }
    });
  }

  async generateInternal(company: CompanyContext, skuId: string): Promise<BarcodeView> {
    const sku = await this.requireSku(company, skuId);

    const existingInternal = await this.database.client.barcode.findFirst({
      where: {
        companyId: company.companyId,
        skuId: sku.id,
        type: BarcodeType.INTERNAL,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (existingInternal) {
      throw new AppError({
        code: ERROR_CODES.INTERNAL_BARCODE_ALREADY_EXISTS,
        message: CATALOG_ERROR_MESSAGES.INTERNAL_BARCODE_ALREADY_EXISTS,
        statusCode: 409,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      let lastError: unknown;
      for (let attempt = 0; attempt < INTERNAL_BARCODE_GENERATION_RETRIES; attempt++) {
        const candidate = generateInternalBarcodeValue();
        const normalized = normalizeAndValidateBarcode(candidate, BarcodeType.INTERNAL);
        try {
          const created = await this.database.client.$transaction(async (tx) => {
            const activeCount = await tx.barcode.count({
              where: { companyId: company.companyId, skuId: sku.id, archivedAt: null },
            });
            const makePrimary = activeCount === 0;
            if (makePrimary) {
              await tx.barcode.updateMany({
                where: {
                  skuId: sku.id,
                  companyId: company.companyId,
                  isPrimary: true,
                  archivedAt: null,
                },
                data: { isPrimary: false },
              });
            }

            const barcode = await tx.barcode.create({
              data: {
                companyId: company.companyId,
                skuId: sku.id,
                value: normalized.value,
                normalizedValue: normalized.normalizedValue,
                type: BarcodeType.INTERNAL,
                isPrimary: makePrimary,
              },
            });

            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.BARCODE_INTERNAL_GENERATED,
              entityType: AUDIT_ENTITY_TYPES.BARCODE,
              entityId: barcode.id,
              before: null,
              after: this.snapshot(barcode),
              metadata: {
                skuId: barcode.skuId,
                productId: sku.productId,
                type: barcode.type,
                value: barcode.value,
              },
            });

            return barcode;
          });

          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.CATALOG_BARCODE_INTERNAL_GENERATED,
              payload: {
                companyId: company.companyId,
                productId: sku.productId,
                skuId: created.skuId,
                barcodeId: created.id,
              },
            }),
          );
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.CATALOG_BARCODE_CREATED,
              payload: {
                companyId: company.companyId,
                productId: sku.productId,
                skuId: created.skuId,
                barcodeId: created.id,
              },
            }),
          );

          return this.toBarcodeView(created);
        } catch (error) {
          lastError = error;
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            // Collision on value or internal constraint — retry generation.
            continue;
          }
          this.mapBarcodeWriteError(error);
        }
      }

      this.mapBarcodeWriteError(lastError);
    });
  }

  async setPrimary(company: CompanyContext, barcodeId: string): Promise<BarcodeView> {
    const current = await this.requireBarcode(company, barcodeId);
    if (current.archivedAt) {
      throw new AppError({
        code: ERROR_CODES.BARCODE_NOT_ACTIVE,
        message: CATALOG_ERROR_MESSAGES.BARCODE_NOT_ACTIVE,
        statusCode: 409,
      });
    }
    if (current.isPrimary) {
      return this.toBarcodeView(current);
    }

    const sku = await this.requireSku(company, current.skuId);

    return commitThenPublish(this.eventBus, async (events) => {
      try {
        const updated = await this.database.client.$transaction(async (tx) => {
          const demoted = await tx.barcode.findMany({
            where: {
              skuId: current.skuId,
              companyId: company.companyId,
              isPrimary: true,
              archivedAt: null,
              id: { not: current.id },
            },
            select: { id: true, value: true },
          });

          await tx.barcode.updateMany({
            where: {
              skuId: current.skuId,
              companyId: company.companyId,
              isPrimary: true,
              archivedAt: null,
              id: { not: current.id },
            },
            data: { isPrimary: false },
          });

          const barcode = await tx.barcode.update({
            where: { id: current.id },
            data: { isPrimary: true },
          });

          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.BARCODE_PRIMARY_CHANGED,
            entityType: AUDIT_ENTITY_TYPES.BARCODE,
            entityId: barcode.id,
            before: this.snapshot(current),
            after: this.snapshot(barcode),
            metadata: {
              skuId: barcode.skuId,
              productId: sku.productId,
              previousPrimaryId: demoted[0]?.id ?? null,
              demotedBarcodeIds: demoted.map((row) => row.id),
              demotedBarcodeValues: demoted.map((row) => row.value),
            },
          });

          return barcode;
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.CATALOG_BARCODE_PRIMARY_CHANGED,
            payload: {
              companyId: company.companyId,
              productId: sku.productId,
              skuId: updated.skuId,
              barcodeId: updated.id,
            },
          }),
        );

        return this.toBarcodeView(updated);
      } catch (error) {
        this.mapBarcodeWriteError(error);
      }
    });
  }

  /**
   * Archive barcode (never hard-delete). Value remains reserved.
   * If archived barcode was primary, promote the oldest remaining active barcode.
   */
  async archive(company: CompanyContext, barcodeId: string): Promise<BarcodeView> {
    const current = await this.requireBarcode(company, barcodeId);
    if (current.archivedAt) {
      throw new AppError({
        code: ERROR_CODES.BARCODE_ALREADY_ARCHIVED,
        message: CATALOG_ERROR_MESSAGES.BARCODE_ALREADY_ARCHIVED,
        statusCode: 409,
      });
    }

    const sku = await this.requireSku(company, current.skuId);

    return commitThenPublish(this.eventBus, async (events) => {
      const archived = await this.database.client.$transaction(async (tx) => {
        const barcode = await tx.barcode.update({
          where: { id: current.id },
          data: {
            archivedAt: new Date(),
            isPrimary: false,
          },
        });

        if (current.isPrimary) {
          const next = await tx.barcode.findFirst({
            where: {
              companyId: company.companyId,
              skuId: current.skuId,
              archivedAt: null,
              id: { not: current.id },
            },
            orderBy: { createdAt: 'asc' },
          });
          if (next) {
            await tx.barcode.update({
              where: { id: next.id },
              data: { isPrimary: true },
            });
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.BARCODE_PRIMARY_CHANGED,
              entityType: AUDIT_ENTITY_TYPES.BARCODE,
              entityId: next.id,
              before: this.snapshot(next),
              after: this.snapshot({ ...next, isPrimary: true }),
              metadata: {
                skuId: next.skuId,
                productId: sku.productId,
                reason: 'promote_after_primary_archive',
                archivedBarcodeId: current.id,
              },
            });
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.CATALOG_BARCODE_PRIMARY_CHANGED,
                payload: {
                  companyId: company.companyId,
                  productId: sku.productId,
                  skuId: next.skuId,
                  barcodeId: next.id,
                },
              }),
            );
          }
        }

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.BARCODE_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.BARCODE,
          entityId: barcode.id,
          before: this.snapshot(current),
          after: this.snapshot(barcode),
          metadata: {
            skuId: barcode.skuId,
            productId: sku.productId,
            type: barcode.type,
            value: barcode.value,
          },
        });

        return barcode;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.CATALOG_BARCODE_ARCHIVED,
          payload: {
            companyId: company.companyId,
            productId: sku.productId,
            skuId: archived.skuId,
            barcodeId: archived.id,
          },
        }),
      );

      return this.toBarcodeView(archived);
    });
  }

  private mapBarcodeWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String(error.meta?.target ?? '').toLowerCase();
      const constraint = String(error.meta?.modelName ?? '').toLowerCase();
      const haystack = `${target} ${constraint} ${JSON.stringify(error.meta ?? {})}`.toLowerCase();
      if (haystack.includes('one_primary') || haystack.includes('primary_active')) {
        throw new AppError({
          code: ERROR_CODES.PRIMARY_BARCODE_CONFLICT,
          message: CATALOG_ERROR_MESSAGES.PRIMARY_BARCODE_CONFLICT,
          statusCode: 409,
        });
      }
      if (haystack.includes('one_active_internal') || haystack.includes('active_internal')) {
        throw new AppError({
          code: ERROR_CODES.INTERNAL_BARCODE_ALREADY_EXISTS,
          message: CATALOG_ERROR_MESSAGES.INTERNAL_BARCODE_ALREADY_EXISTS,
          statusCode: 409,
        });
      }
    }
    mapCatalogUniqueViolation(error, 'barcode_value');
  }

  private async requireSku(
    company: CompanyContext,
    skuId: string,
  ): Promise<{ id: string; productId: string }> {
    const sku = await this.database.client.sku.findFirst({
      where: { id: skuId, companyId: company.companyId },
      select: { id: true, productId: true },
    });
    if (!sku) {
      throw new AppError({
        code: ERROR_CODES.SKU_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.SKU_NOT_FOUND,
        statusCode: 404,
      });
    }
    return sku;
  }

  private async requireBarcode(company: CompanyContext, barcodeId: string): Promise<BarcodeRow> {
    const row = await this.database.client.barcode.findFirst({
      where: { id: barcodeId, companyId: company.companyId },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.BARCODE_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.BARCODE_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private snapshot(barcode: {
    id: string;
    skuId: string;
    value: string;
    normalizedValue?: string;
    type: BarcodeType;
    isPrimary: boolean;
    archivedAt?: Date | null;
  }) {
    return {
      id: barcode.id,
      skuId: barcode.skuId,
      value: barcode.value,
      normalizedValue: barcode.normalizedValue ?? barcode.value,
      type: barcode.type,
      isPrimary: barcode.isPrimary,
      archivedAt: barcode.archivedAt ? barcode.archivedAt.toISOString() : null,
    };
  }

  private toBarcodeView(row: BarcodeRow): BarcodeView {
    return {
      id: row.id,
      companyId: row.companyId,
      skuId: row.skuId,
      value: row.value,
      normalizedValue: row.normalizedValue,
      type: row.type,
      isPrimary: row.isPrimary,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toSkuView(row: SkuRow): SkuView {
    return toSkuView(row);
  }

  private toProductView(row: {
    id: string;
    companyId: string;
    name: string;
    code: string | null;
    description: string | null;
    brandId: string | null;
    categoryId: string | null;
    status: CatalogLifecycleStatus;
    createdAt: Date;
    updatedAt: Date;
    archivedAt: Date | null;
  }): ProductView {
    return {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      code: row.code,
      description: row.description,
      brandId: row.brandId,
      categoryId: row.categoryId,
      brand: null,
      category: null,
      categoryPath: null,
      status: row.status,
      skuCount: 0,
      activeSkuCount: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
    };
  }
}
