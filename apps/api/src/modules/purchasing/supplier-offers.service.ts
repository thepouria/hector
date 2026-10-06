import { Injectable } from '@nestjs/common';
import {
  CatalogLifecycleStatus,
  CurrencyCode,
  PaymentTermType,
  Prisma,
  PurchaseCommercialType,
  PurchasingLifecycleStatus,
} from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
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
import { CatalogQueryService } from '../catalog/catalog-query.service';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit.constants';
import { AuditService } from '../audit/audit.service';
import { auditSnapshotsEqual } from '../audit/serializers/audit-sanitizer';
import type { CompanyContext } from '../companies/types/company.types';
import type { CompareSupplierOffersQueryDto } from './dto/compare-supplier-offers.query.dto';
import type { CreateSupplierOfferDto } from './dto/create-supplier-offer.dto';
import type { ListSupplierOffersQueryDto } from './dto/list-supplier-offers.query.dto';
import type { UpdateSupplierOfferDto } from './dto/update-supplier-offer.dto';
import { PURCHASING_ERROR_MESSAGES } from './purchasing.constants';
import { normalizeSearchQuery } from './purchasing.normalization';
import {
  assertOfferCommercialTerms,
  assertOfferFxReference,
  assertOfferValidity,
  assertOptionalOfferNotes,
  assertSupplierAssignableForOffer,
  deriveOfferExpiry,
  parseOptionalPositiveFxRate,
  parsePositiveMoney,
} from './supplier-offer.validation';
import { SuppliersService } from './suppliers.service';

export type SupplierOfferView = {
  id: string;
  companyId: string;
  supplierId: string;
  skuId: string;
  supplierContactId: string | null;
  unitPrice: string;
  currency: CurrencyCode;
  purchaseType: PurchaseCommercialType | null;
  paymentTermType: PaymentTermType | null;
  netDays: number | null;
  quotedQuantity: number | null;
  minimumQuantity: number | null;
  availableQuantity: number | null;
  referenceFxRate: string | null;
  referenceFxBaseCurrency: CurrencyCode | null;
  referenceFxQuoteCurrency: CurrencyCode | null;
  quotedAt: Date;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  expiryState: 'ARCHIVED' | 'EXPIRED' | 'CURRENT' | 'NO_EXPIRY';
  supplier: { id: string; name: string; code: string | null; status: PurchasingLifecycleStatus };
  sku: {
    id: string;
    code: string;
    name: string | null;
    status: CatalogLifecycleStatus;
    product: { id: string; name: string; code: string | null };
  };
  supplierContact: { id: string; name: string; role: string | null } | null;
  createdBy: { id: string; displayName: string };
};

@Injectable()
export class SupplierOffersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly suppliersService: SuppliersService,
    private readonly catalogQuery: CatalogQueryService,
  ) {}

  async list(
    company: CompanyContext,
    query: ListSupplierOffersQueryDto,
  ): Promise<{ data: SupplierOfferView[]; meta: PaginationMeta }> {
    const search = normalizeSearchQuery(query.search);
    const now = new Date();
    const and: Prisma.SupplierOfferWhereInput[] = [];

    if (query.quotedFrom || query.quotedTo) {
      and.push({
        quotedAt: {
          ...(query.quotedFrom ? { gte: new Date(query.quotedFrom) } : {}),
          ...(query.quotedTo ? { lte: new Date(query.quotedTo) } : {}),
        },
      });
    }

    if (query.validAt) {
      const at = new Date(query.validAt);
      and.push({
        archivedAt: null,
        quotedAt: { lte: at },
        OR: [{ validUntil: null }, { validUntil: { gte: at } }],
      });
    }

    const validity = this.validityWhere(query.validity, now);
    if (Object.keys(validity).length > 0) {
      and.push(validity);
    }

    if (search) {
      and.push({
        OR: [
          { supplier: { name: { contains: search, mode: 'insensitive' } } },
          { supplier: { code: { contains: search, mode: 'insensitive' } } },
          { sku: { code: { contains: search, mode: 'insensitive' } } },
          { sku: { name: { contains: search, mode: 'insensitive' } } },
          { sku: { product: { name: { contains: search, mode: 'insensitive' } } } },
          {
            sku: {
              barcodes: {
                some: {
                  companyId: company.companyId,
                  archivedAt: null,
                  value: { contains: search },
                },
              },
            },
          },
        ],
      });
    }

    const where: Prisma.SupplierOfferWhereInput = {
      companyId: company.companyId,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.skuId ? { skuId: query.skuId } : {}),
      ...(query.productId ? { sku: { productId: query.productId } } : {}),
      ...(query.currency ? { currency: query.currency } : {}),
      ...(query.purchaseType ? { purchaseType: query.purchaseType } : {}),
      ...(query.paymentTermType ? { paymentTermType: query.paymentTermType } : {}),
      ...(and.length > 0 ? { AND: and } : {}),
    };

    const skip = (query.page - 1) * query.pageSize;
    const orderBy: Prisma.SupplierOfferOrderByWithRelationInput[] = [
      { [query.sortBy]: query.sortOrder },
      { createdAt: 'desc' },
      { id: 'desc' },
    ];

    const [total, rows] = await this.database.client.$transaction([
      this.database.client.supplierOffer.count({ where }),
      this.database.client.supplierOffer.findMany({
        where,
        orderBy,
        skip,
        take: query.pageSize,
        include: this.offerInclude(),
      }),
    ]);

    return {
      data: rows.map((row) => this.toView(row, now)),
      meta: buildPaginationMeta(query.page, query.pageSize, total),
    };
  }

  async get(company: CompanyContext, offerId: string): Promise<SupplierOfferView> {
    const row = await this.requireOffer(company.companyId, offerId);
    return this.toView(row);
  }

  async compare(
    company: CompanyContext,
    query: CompareSupplierOffersQueryDto,
  ): Promise<{ data: SupplierOfferView[] }> {
    await this.catalogQuery.getSkuIdentity(company.companyId, query.skuId);
    const now = new Date();
    const rows = await this.database.client.supplierOffer.findMany({
      where: {
        companyId: company.companyId,
        skuId: query.skuId,
        archivedAt: null,
        ...(query.excludeExpired
          ? {
              OR: [{ validUntil: null }, { validUntil: { gte: now } }],
            }
          : {}),
      },
      orderBy: [{ quotedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: this.offerInclude(),
    });

    const latestBySupplier = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latestBySupplier.has(row.supplierId)) {
        latestBySupplier.set(row.supplierId, row);
      }
    }

    const data = [...latestBySupplier.values()]
      .map((row) => this.toView(row, now))
      .sort((a, b) => {
        if (a.currency === b.currency) {
          const cmp = new Prisma.Decimal(a.unitPrice).cmp(new Prisma.Decimal(b.unitPrice));
          if (cmp !== 0) return cmp;
        }
        return b.quotedAt.getTime() - a.quotedAt.getTime();
      });

    return { data };
  }

  async latestForSupplierSku(
    company: CompanyContext,
    supplierId: string,
    skuId: string,
  ): Promise<SupplierOfferView | null> {
    const row = await this.database.client.supplierOffer.findFirst({
      where: {
        companyId: company.companyId,
        supplierId,
        skuId,
        archivedAt: null,
      },
      orderBy: [{ quotedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: this.offerInclude(),
    });
    return row ? this.toView(row) : null;
  }

  async create(company: CompanyContext, dto: CreateSupplierOfferDto): Promise<SupplierOfferView> {
    const supplier = await this.suppliersService.requireSupplier(
      company.companyId,
      dto.supplierId,
    );
    assertSupplierAssignableForOffer(supplier.status);

    const skuIdentity = await this.catalogQuery.getSkuIdentity(company.companyId, dto.skuId);
    if (skuIdentity.skuStatus === CatalogLifecycleStatus.ARCHIVED) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_SKU_NOT_ASSIGNABLE,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_SKU_NOT_ASSIGNABLE,
        statusCode: 409,
      });
    }

    await this.assertContact(company.companyId, dto.supplierId, dto.supplierContactId);

    const unitPrice = parsePositiveMoney(dto.unitPrice, dto.currency);
    const quotedAt = new Date(dto.quotedAt);
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    assertOfferValidity(quotedAt, validUntil);

    const purchaseType = dto.purchaseType ?? null;
    const paymentTermType =
      dto.paymentTermType ??
      (purchaseType === PurchaseCommercialType.CASH
        ? PaymentTermType.IMMEDIATE
        : purchaseType === PurchaseCommercialType.TERM_CREDIT
          ? PaymentTermType.NET_DAYS
          : null);
    const netDays = dto.netDays ?? null;
    assertOfferCommercialTerms({ purchaseType, paymentTermType, netDays });

    const referenceFxRate = parseOptionalPositiveFxRate(dto.referenceFxRate) ?? null;
    const referenceFxBaseCurrency = dto.referenceFxBaseCurrency ?? null;
    const referenceFxQuoteCurrency = dto.referenceFxQuoteCurrency ?? null;
    assertOfferFxReference({
      referenceFxRate,
      referenceFxBaseCurrency,
      referenceFxQuoteCurrency,
    });

    const notes = assertOptionalOfferNotes(dto.notes) ?? null;
    const actorUserId = this.suppliersService.requireActorUserId();

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const offer = await tx.supplierOffer.create({
          data: {
            companyId: company.companyId,
            supplierId: dto.supplierId,
            skuId: dto.skuId,
            supplierContactId: dto.supplierContactId ?? null,
            unitPrice,
            currency: dto.currency,
            purchaseType,
            paymentTermType,
            netDays,
            quotedQuantity: dto.quotedQuantity ?? null,
            minimumQuantity: dto.minimumQuantity ?? null,
            availableQuantity: dto.availableQuantity ?? null,
            referenceFxRate,
            referenceFxBaseCurrency,
            referenceFxQuoteCurrency,
            quotedAt,
            validUntil,
            notes,
            createdById: actorUserId,
          },
          include: this.offerInclude(),
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_OFFER_CREATED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_OFFER,
          entityId: offer.id,
          before: null,
          after: this.snapshot(offer),
        });

        return offer;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_CREATED,
          payload: {
            companyId: company.companyId,
            supplierOfferId: created.id,
            supplierId: created.supplierId,
            skuId: created.skuId,
            currency: created.currency,
            quotedAt: created.quotedAt.toISOString(),
          },
        }),
      );

      return this.toView(created);
    });
  }

  async update(
    company: CompanyContext,
    offerId: string,
    dto: UpdateSupplierOfferDto,
  ): Promise<SupplierOfferView> {
    const current = await this.requireOffer(company.companyId, offerId);
    if (current.archivedAt) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_ALREADY_ARCHIVED,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_ALREADY_ARCHIVED,
        statusCode: 409,
      });
    }

    if (
      dto.unitPrice === undefined &&
      dto.currency === undefined &&
      dto.purchaseType === undefined &&
      dto.paymentTermType === undefined &&
      dto.netDays === undefined &&
      dto.quotedQuantity === undefined &&
      dto.minimumQuantity === undefined &&
      dto.availableQuantity === undefined &&
      dto.referenceFxRate === undefined &&
      dto.referenceFxBaseCurrency === undefined &&
      dto.referenceFxQuoteCurrency === undefined &&
      dto.quotedAt === undefined &&
      dto.validUntil === undefined &&
      dto.supplierContactId === undefined &&
      dto.notes === undefined
    ) {
      throw AppError.validation('At least one field is required to update the offer.');
    }

    const currency = dto.currency ?? current.currency;
    const unitPrice =
      dto.unitPrice !== undefined
        ? parsePositiveMoney(dto.unitPrice, currency)
        : current.unitPrice;
    const quotedAt = dto.quotedAt !== undefined ? new Date(dto.quotedAt) : current.quotedAt;
    const validUntil =
      dto.validUntil !== undefined
        ? dto.validUntil === null
          ? null
          : new Date(dto.validUntil)
        : current.validUntil;
    assertOfferValidity(quotedAt, validUntil);

    const purchaseType =
      dto.purchaseType !== undefined ? dto.purchaseType : current.purchaseType;
    const paymentTermType =
      dto.paymentTermType !== undefined ? dto.paymentTermType : current.paymentTermType;
    const netDays = dto.netDays !== undefined ? dto.netDays : current.netDays;
    assertOfferCommercialTerms({ purchaseType, paymentTermType, netDays });

    const referenceFxRate =
      dto.referenceFxRate !== undefined
        ? (parseOptionalPositiveFxRate(dto.referenceFxRate) ?? null)
        : current.referenceFxRate;
    const referenceFxBaseCurrency =
      dto.referenceFxBaseCurrency !== undefined
        ? dto.referenceFxBaseCurrency
        : current.referenceFxBaseCurrency;
    const referenceFxQuoteCurrency =
      dto.referenceFxQuoteCurrency !== undefined
        ? dto.referenceFxQuoteCurrency
        : current.referenceFxQuoteCurrency;
    assertOfferFxReference({
      referenceFxRate,
      referenceFxBaseCurrency,
      referenceFxQuoteCurrency,
    });

    if (dto.supplierContactId !== undefined) {
      await this.assertContact(
        company.companyId,
        current.supplierId,
        dto.supplierContactId ?? undefined,
      );
    }

    const notes =
      dto.notes !== undefined ? (assertOptionalOfferNotes(dto.notes) ?? null) : current.notes;

    return commitThenPublish(this.eventBus, async (events) => {
      const updated = await this.database.client.$transaction(async (tx) => {
        const offer = await tx.supplierOffer.update({
          where: { id: current.id },
          data: {
            unitPrice,
            currency,
            purchaseType,
            paymentTermType,
            netDays,
            quotedQuantity:
              dto.quotedQuantity !== undefined ? dto.quotedQuantity : current.quotedQuantity,
            minimumQuantity:
              dto.minimumQuantity !== undefined ? dto.minimumQuantity : current.minimumQuantity,
            availableQuantity:
              dto.availableQuantity !== undefined
                ? dto.availableQuantity
                : current.availableQuantity,
            referenceFxRate,
            referenceFxBaseCurrency,
            referenceFxQuoteCurrency,
            quotedAt,
            validUntil,
            supplierContactId:
              dto.supplierContactId !== undefined
                ? dto.supplierContactId
                : current.supplierContactId,
            notes,
          },
          include: this.offerInclude(),
        });

        const before = this.snapshot(current);
        const after = this.snapshot(offer);
        const audited = await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_OFFER_UPDATED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_OFFER,
          entityId: offer.id,
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
              type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_UPDATED,
              payload: {
                companyId: company.companyId,
                supplierOfferId: offer.id,
                supplierId: offer.supplierId,
                skuId: offer.skuId,
                changedFields,
              },
            }),
          );
        }

        return offer;
      });

      return this.toView(updated);
    });
  }

  async archive(company: CompanyContext, offerId: string): Promise<SupplierOfferView> {
    const current = await this.requireOffer(company.companyId, offerId);
    if (current.archivedAt) {
      return this.toView(current);
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const archived = await this.database.client.$transaction(async (tx) => {
        const offer = await tx.supplierOffer.update({
          where: { id: current.id },
          data: { archivedAt: new Date() },
          include: this.offerInclude(),
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.SUPPLIER_OFFER_ARCHIVED,
          entityType: AUDIT_ENTITY_TYPES.SUPPLIER_OFFER,
          entityId: offer.id,
          before: this.snapshot(current),
          after: this.snapshot(offer),
        });

        return offer;
      });

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_ARCHIVED,
          payload: {
            companyId: company.companyId,
            supplierOfferId: archived.id,
            supplierId: archived.supplierId,
            skuId: archived.skuId,
          },
        }),
      );

      return this.toView(archived);
    });
  }

  private validityWhere(
    validity: ListSupplierOffersQueryDto['validity'],
    now: Date,
  ): Prisma.SupplierOfferWhereInput {
    if (!validity || validity === 'ACTIVE') {
      return { archivedAt: null };
    }
    if (validity === 'ARCHIVED') {
      return { archivedAt: { not: null } };
    }
    if (validity === 'NO_EXPIRY') {
      return { archivedAt: null, validUntil: null };
    }
    if (validity === 'EXPIRED') {
      return { archivedAt: null, validUntil: { lt: now } };
    }
    // CURRENT
    return {
      archivedAt: null,
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
    };
  }

  private async assertContact(
    companyId: string,
    supplierId: string,
    contactId: string | undefined,
  ): Promise<void> {
    if (!contactId) return;
    const contact = await this.database.client.supplierContact.findFirst({
      where: {
        id: contactId,
        companyId,
        supplierId,
        archivedAt: null,
      },
    });
    if (!contact) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_CONTACT_INVALID,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_CONTACT_INVALID,
        statusCode: 400,
      });
    }
  }

  private async requireOffer(companyId: string, offerId: string) {
    const row = await this.database.client.supplierOffer.findFirst({
      where: { id: offerId, companyId },
      include: this.offerInclude(),
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.SUPPLIER_OFFER_NOT_FOUND,
        message: PURCHASING_ERROR_MESSAGES.SUPPLIER_OFFER_NOT_FOUND,
        statusCode: 404,
      });
    }
    return row;
  }

  private offerInclude() {
    return {
      supplier: { select: { id: true, name: true, code: true, status: true } },
      sku: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          product: { select: { id: true, name: true, code: true } },
        },
      },
      supplierContact: { select: { id: true, name: true, role: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    } satisfies Prisma.SupplierOfferInclude;
  }

  private snapshot(offer: {
    id: string;
    supplierId: string;
    skuId: string;
    supplierContactId: string | null;
    unitPrice: Prisma.Decimal;
    currency: CurrencyCode;
    purchaseType: PurchaseCommercialType | null;
    paymentTermType: PaymentTermType | null;
    netDays: number | null;
    quotedQuantity: number | null;
    minimumQuantity: number | null;
    availableQuantity: number | null;
    referenceFxRate: Prisma.Decimal | null;
    referenceFxBaseCurrency: CurrencyCode | null;
    referenceFxQuoteCurrency: CurrencyCode | null;
    quotedAt: Date;
    validUntil: Date | null;
    notes: string | null;
    archivedAt: Date | null;
  }) {
    return {
      id: offer.id,
      supplierId: offer.supplierId,
      skuId: offer.skuId,
      supplierContactId: offer.supplierContactId,
      unitPrice: offer.unitPrice.toString(),
      currency: offer.currency,
      purchaseType: offer.purchaseType,
      paymentTermType: offer.paymentTermType,
      netDays: offer.netDays,
      quotedQuantity: offer.quotedQuantity,
      minimumQuantity: offer.minimumQuantity,
      availableQuantity: offer.availableQuantity,
      referenceFxRate: offer.referenceFxRate?.toString() ?? null,
      referenceFxBaseCurrency: offer.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: offer.referenceFxQuoteCurrency,
      quotedAt: offer.quotedAt.toISOString(),
      validUntil: offer.validUntil?.toISOString() ?? null,
      notes: offer.notes,
      archivedAt: offer.archivedAt?.toISOString() ?? null,
    };
  }

  private toView(
    row: Awaited<ReturnType<SupplierOffersService['requireOffer']>>,
    now = new Date(),
  ): SupplierOfferView {
    return {
      id: row.id,
      companyId: row.companyId,
      supplierId: row.supplierId,
      skuId: row.skuId,
      supplierContactId: row.supplierContactId,
      unitPrice: row.unitPrice.toString(),
      currency: row.currency,
      purchaseType: row.purchaseType,
      paymentTermType: row.paymentTermType,
      netDays: row.netDays,
      quotedQuantity: row.quotedQuantity,
      minimumQuantity: row.minimumQuantity,
      availableQuantity: row.availableQuantity,
      referenceFxRate: row.referenceFxRate?.toString() ?? null,
      referenceFxBaseCurrency: row.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: row.referenceFxQuoteCurrency,
      quotedAt: row.quotedAt,
      validUntil: row.validUntil,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      archivedAt: row.archivedAt,
      expiryState: deriveOfferExpiry(row.validUntil, row.archivedAt, now),
      supplier: row.supplier,
      sku: row.sku,
      supplierContact: row.supplierContact,
      createdBy: (() => {
        const createdBy = row.createdBy as {
          id: string;
          firstName: string;
          lastName: string;
        };
        return {
          id: createdBy.id,
          displayName: `${createdBy.firstName} ${createdBy.lastName}`.trim(),
        };
      })(),
    };
  }
}
