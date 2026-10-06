import { Injectable } from '@nestjs/common';
import {
  PaymentTermType,
  Prisma,
  PurchaseCommercialType,
  PurchaseCorrectionStatus,
  PurchaseCorrectionType,
  PurchaseOrderStatus,
  PurchaseTermBasis,
} from '@hector/database';
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
import type { AuditSnapshot } from '../audit/types/audit.types';
import type { CompanyContext } from '../companies/types/company.types';
import type { CreatePurchaseOrderCorrectionDto } from './dto/create-purchase-order-correction.dto';
import {
  assertPurchaseOrderQuantity,
  computeLineSubtotal,
  computePurchaseOrderTotals,
  parsePurchaseOrderUnitPrice,
} from './purchase-order-money';
import { resolvePurchaseTerms } from './purchase-order-terms';
import { parseUtcBusinessDate } from './purchase-order-due';
import {
  PURCHASE_CORRECTION_ERROR_MESSAGES,
  PURCHASE_ORDER_ERROR_MESSAGES,
} from './purchasing.constants';
import { SuppliersService } from './suppliers.service';

const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000 } as const;

const CORRECTABLE_STATUSES: readonly PurchaseOrderStatus[] = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.ORDERED,
];

export type PurchaseOrderCorrectionView = {
  id: string;
  companyId: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string | null;
  type: PurchaseCorrectionType;
  status: PurchaseCorrectionStatus;
  reason: string;
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  purchaseOrderVersion: number;
  appliedBy: { id: string; displayName: string };
  appliedAt: Date;
  createdAt: Date;
};

@Injectable()
export class PurchaseOrderCorrectionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventBus: DomainEventBus,
    private readonly eventFactory: DomainEventFactory,
    private readonly suppliersService: SuppliersService,
  ) {}

  async list(company: CompanyContext, purchaseOrderId: string): Promise<PurchaseOrderCorrectionView[]> {
    const po = await this.database.client.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, companyId: company.companyId },
      select: { id: true },
    });
    if (!po) this.poNotFound();

    const rows = await this.database.client.purchaseOrderCorrection.findMany({
      where: { companyId: company.companyId, purchaseOrderId },
      orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      include: {
        appliedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return rows.map((row) => this.toView(row));
  }

  async apply(
    company: CompanyContext,
    purchaseOrderId: string,
    dto: CreatePurchaseOrderCorrectionDto,
  ): Promise<PurchaseOrderCorrectionView> {
    const actorUserId = this.suppliersService.requireActorUserId();
    const reason = dto.reason.trim();
    if (!reason) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_CORRECTION_REASON_REQUIRED,
        message: PURCHASE_CORRECTION_ERROR_MESSAGES.REASON_REQUIRED,
        statusCode: 400,
      });
    }

    if (dto.type === PurchaseCorrectionType.SUPPLIER_CORRECTION) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_CORRECTION_UNSUPPORTED,
        message:
          'Supplier correction after commit is not supported. Cancel (if eligible) and create a new purchase order.',
        statusCode: 409,
      });
    }

    return commitThenPublish(this.eventBus, async (events) => {
      const created = await this.database.client.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findFirst({
          where: { id: purchaseOrderId, companyId: company.companyId },
          include: { items: true },
        });
        if (!po) this.poNotFound();
        if (po.version !== dto.version) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_ORDER_VERSION_CONFLICT,
            message: PURCHASE_ORDER_ERROR_MESSAGES.VERSION_CONFLICT,
            statusCode: 409,
          });
        }
        if (!CORRECTABLE_STATUSES.includes(po.status)) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_CORRECTION_NOT_ALLOWED,
            message: `${PURCHASE_CORRECTION_ERROR_MESSAGES.NOT_ALLOWED} (status=${po.status})`,
            statusCode: 409,
          });
        }

        let beforeSnapshot: Record<string, unknown> = {};
        let afterSnapshot: Record<string, unknown> = {};
        let purchaseOrderItemId: string | null = null;

        const itemTypes: PurchaseCorrectionType[] = [
          PurchaseCorrectionType.QUANTITY_CORRECTION,
          PurchaseCorrectionType.PRICE_CORRECTION,
          PurchaseCorrectionType.DATA_ENTRY_ERROR,
        ];

        if (itemTypes.includes(dto.type)) {
          if (!dto.purchaseOrderItemId) {
            throw new AppError({
              code: ERROR_CODES.PURCHASE_CORRECTION_UNSUPPORTED,
              message: 'Item-scoped corrections require purchaseOrderItemId.',
              statusCode: 400,
            });
          }
          const item = po.items.find((i) => i.id === dto.purchaseOrderItemId);
          if (!item) {
            throw new AppError({
              code: ERROR_CODES.PURCHASE_ORDER_ITEM_NOT_FOUND,
              message: PURCHASE_ORDER_ERROR_MESSAGES.ITEM_NOT_FOUND,
              statusCode: 404,
            });
          }
          purchaseOrderItemId = item.id;

          const nextQuantity =
            dto.quantity !== undefined
              ? assertPurchaseOrderQuantity(dto.quantity)
              : item.quantity;
          const nextUnitPrice =
            dto.unitPrice !== undefined
              ? parsePurchaseOrderUnitPrice(dto.unitPrice, po.currency)
              : item.unitPrice;

          if (
            dto.type === PurchaseCorrectionType.QUANTITY_CORRECTION &&
            dto.quantity === undefined
          ) {
            throw unsupported('QUANTITY_CORRECTION requires quantity.');
          }
          if (dto.type === PurchaseCorrectionType.PRICE_CORRECTION && dto.unitPrice === undefined) {
            throw unsupported('PRICE_CORRECTION requires unitPrice.');
          }
          if (
            dto.type === PurchaseCorrectionType.DATA_ENTRY_ERROR &&
            dto.quantity === undefined &&
            dto.unitPrice === undefined
          ) {
            throw unsupported('DATA_ENTRY_ERROR requires quantity and/or unitPrice.');
          }

          if (nextQuantity < item.closedUnfulfilledQuantity) {
            throw new AppError({
              code: ERROR_CODES.PURCHASE_CORRECTION_NOT_ALLOWED,
              message:
                'Corrected ordered quantity cannot be below already short-closed quantity.',
              statusCode: 409,
            });
          }
          if (nextQuantity === item.quantity && nextUnitPrice.equals(item.unitPrice)) {
            throw noChange();
          }

          beforeSnapshot = {
            purchaseOrderItemId: item.id,
            skuId: item.skuId,
            quantity: item.quantity,
            unitPrice: item.unitPrice.toString(),
            lineSubtotal: item.lineSubtotal.toString(),
          };
          const lineSubtotal = computeLineSubtotal(nextQuantity, nextUnitPrice);
          afterSnapshot = {
            purchaseOrderItemId: item.id,
            skuId: item.skuId,
            quantity: nextQuantity,
            unitPrice: nextUnitPrice.toString(),
            lineSubtotal: lineSubtotal.toString(),
          };

          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { quantity: nextQuantity, unitPrice: nextUnitPrice, lineSubtotal },
          });

          const items = await tx.purchaseOrderItem.findMany({
            where: { purchaseOrderId: po.id, companyId: company.companyId },
            select: { quantity: true, unitPrice: true },
          });
          const { subtotal, total } = computePurchaseOrderTotals(items);
          const obligationPatch =
            po.purchaseType === PurchaseCommercialType.FX_CREDIT
              ? { obligationAmount: total }
              : {};

          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: {
              subtotal,
              total,
              ...obligationPatch,
              version: { increment: 1 },
            },
          });
        } else if (dto.type === PurchaseCorrectionType.COMMERCIAL_TERM_CORRECTION) {
          if (po.purchaseType === PurchaseCommercialType.CASH) {
            throw unsupported('CASH purchase orders do not accept credit-term corrections.');
          }
          if (po.purchaseType === PurchaseCommercialType.FX_CREDIT) {
            // FX obligation / reference rate corrections use OTHER/FX fields via same type path below
          }

          const wantsTerms =
            dto.paymentTermType !== undefined ||
            dto.netDays !== undefined ||
            dto.dueDate !== undefined;
          const wantsFx =
            dto.obligationAmount !== undefined ||
            dto.referenceFxRate !== undefined ||
            dto.referenceFxRateAt !== undefined;

          if (!wantsTerms && !wantsFx) {
            throw unsupported(
              'COMMERCIAL_TERM_CORRECTION requires payment terms and/or FX obligation fields.',
            );
          }

          beforeSnapshot = this.termsSnapshot(po);
          const terms = resolvePurchaseTerms({
            purchaseType: po.purchaseType,
            paymentTermType: dto.paymentTermType ?? po.paymentTermType,
            netDays: dto.netDays !== undefined ? dto.netDays : po.netDays,
            dueDate:
              dto.dueDate !== undefined
                ? dto.dueDate
                : po.dueDate
                  ? po.dueDate
                  : null,
            obligationAmount:
              dto.obligationAmount !== undefined
                ? dto.obligationAmount
                : po.obligationAmount,
            obligationCurrency: po.obligationCurrency,
            referenceFxRate:
              dto.referenceFxRate !== undefined ? dto.referenceFxRate : po.referenceFxRate,
            referenceFxBaseCurrency: po.referenceFxBaseCurrency,
            referenceFxQuoteCurrency: po.referenceFxQuoteCurrency,
            referenceFxRateAt:
              dto.referenceFxRateAt !== undefined
                ? dto.referenceFxRateAt
                  ? parseUtcBusinessDate(dto.referenceFxRateAt)
                  : null
                : po.referenceFxRateAt,
            currency: po.currency,
            orderDate: po.orderDate,
            total: po.total,
            complete: true,
          });

          // Preserve FX obligation when only rate changes and obligationAmount not supplied.
          if (
            po.purchaseType === PurchaseCommercialType.FX_CREDIT &&
            dto.obligationAmount === undefined
          ) {
            terms.obligationAmount = po.obligationAmount;
          }

          afterSnapshot = {
            paymentTermType: terms.paymentTermType,
            netDays: terms.netDays,
            termBasis: terms.termBasis,
            dueDate: terms.dueDate?.toISOString() ?? null,
            obligationAmount: terms.obligationAmount?.toString() ?? null,
            obligationCurrency: terms.obligationCurrency,
            referenceFxRate: terms.referenceFxRate?.toString() ?? null,
            referenceFxBaseCurrency: terms.referenceFxBaseCurrency,
            referenceFxQuoteCurrency: terms.referenceFxQuoteCurrency,
            referenceFxRateAt: terms.referenceFxRateAt?.toISOString() ?? null,
          };

          if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) {
            throw noChange();
          }

          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: {
              paymentTermType: terms.paymentTermType,
              netDays: terms.netDays,
              termBasis: terms.termBasis,
              dueDate: terms.dueDate,
              obligationAmount: terms.obligationAmount,
              obligationCurrency: terms.obligationCurrency,
              referenceFxRate: terms.referenceFxRate,
              referenceFxBaseCurrency: terms.referenceFxBaseCurrency,
              referenceFxQuoteCurrency: terms.referenceFxQuoteCurrency,
              referenceFxRateAt: terms.referenceFxRateAt,
              version: { increment: 1 },
            },
          });
        } else if (dto.type === PurchaseCorrectionType.OTHER) {
          throw unsupported(
            'OTHER corrections must use QUANTITY_CORRECTION, PRICE_CORRECTION, DATA_ENTRY_ERROR, or COMMERCIAL_TERM_CORRECTION.',
          );
        } else {
          throw unsupported(`Unsupported correction type: ${dto.type}`);
        }

        const row = await tx.purchaseOrderCorrection.create({
          data: {
            companyId: company.companyId,
            purchaseOrderId: po.id,
            purchaseOrderItemId,
            type: dto.type,
            status: PurchaseCorrectionStatus.APPLIED,
            reason,
            beforeSnapshot: beforeSnapshot as Prisma.InputJsonValue,
            afterSnapshot: afterSnapshot as Prisma.InputJsonValue,
            purchaseOrderVersion: po.version,
            appliedById: actorUserId,
          },
          include: {
            appliedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_ORDER_CORRECTED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_CORRECTION,
          entityId: row.id,
          before: beforeSnapshot as AuditSnapshot,
          after: {
            ...afterSnapshot,
            correctionId: row.id,
            type: dto.type,
            reason,
            purchaseOrderId: po.id,
          } as AuditSnapshot,
          metadata: { purchaseOrderId: po.id, number: po.number, reason },
        });

        events.push(
          this.eventFactory.create({
            type: DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CORRECTED,
            payload: {
              companyId: company.companyId,
              purchaseOrderId: po.id,
              correctionId: row.id,
              type: dto.type,
              purchaseOrderItemId,
            },
          }),
        );

        if (dto.type === PurchaseCorrectionType.COMMERCIAL_TERM_CORRECTION) {
          const beforeDue = (beforeSnapshot as { dueDate?: string | null }).dueDate ?? null;
          const afterDue = (afterSnapshot as { dueDate?: string | null }).dueDate ?? null;
          if (beforeDue !== afterDue) {
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.PURCHASE_DUE_DATE_CHANGED,
              entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER,
              entityId: po.id,
              before: { dueDate: beforeDue },
              after: { dueDate: afterDue, reason, correctionId: row.id },
              metadata: { purchaseOrderId: po.id, correctionId: row.id, reason },
            });
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PURCHASING_PURCHASE_DUE_DATE_CHANGED,
                payload: {
                  companyId: company.companyId,
                  purchaseOrderId: po.id,
                  correctionId: row.id,
                  previousDueDate: beforeDue,
                  newDueDate: afterDue,
                },
              }),
            );
          }

          const beforeFx = beforeSnapshot as {
            obligationAmount?: string | null;
            obligationCurrency?: string | null;
            referenceFxRate?: string | null;
          };
          const afterFx = afterSnapshot as {
            obligationAmount?: string | null;
            obligationCurrency?: string | null;
            referenceFxRate?: string | null;
          };
          const fxChanged =
            beforeFx.obligationAmount !== afterFx.obligationAmount ||
            beforeFx.referenceFxRate !== afterFx.referenceFxRate;
          if (fxChanged) {
            await this.auditService.record(tx, {
              action: AUDIT_ACTIONS.PURCHASE_FX_TERMS_CHANGED,
              entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER,
              entityId: po.id,
              before: {
                obligationAmount: beforeFx.obligationAmount ?? null,
                obligationCurrency: beforeFx.obligationCurrency ?? null,
                referenceFxRate: beforeFx.referenceFxRate ?? null,
              },
              after: {
                obligationAmount: afterFx.obligationAmount ?? null,
                obligationCurrency: afterFx.obligationCurrency ?? null,
                referenceFxRate: afterFx.referenceFxRate ?? null,
                reason,
                correctionId: row.id,
              },
              metadata: { purchaseOrderId: po.id, correctionId: row.id, reason },
            });
            events.push(
              this.eventFactory.create({
                type: DOMAIN_EVENTS.PURCHASING_PURCHASE_FX_TERMS_CHANGED,
                payload: {
                  companyId: company.companyId,
                  purchaseOrderId: po.id,
                  correctionId: row.id,
                  previousObligationAmount: beforeFx.obligationAmount ?? null,
                  newObligationAmount: afterFx.obligationAmount ?? null,
                  obligationCurrency:
                    afterFx.obligationCurrency ?? beforeFx.obligationCurrency ?? null,
                  previousReferenceFxRate: beforeFx.referenceFxRate ?? null,
                  newReferenceFxRate: afterFx.referenceFxRate ?? null,
                },
              }),
            );
          }
        }

        return row;
      }, TX_OPTIONS);

      return this.toView(created);
    });
  }

  private termsSnapshot(po: {
    paymentTermType: PaymentTermType | null;
    netDays: number | null;
    termBasis: PurchaseTermBasis | null;
    dueDate: Date | null;
    obligationAmount: Prisma.Decimal | null;
    obligationCurrency: string | null;
    referenceFxRate: Prisma.Decimal | null;
    referenceFxBaseCurrency: string | null;
    referenceFxQuoteCurrency: string | null;
    referenceFxRateAt: Date | null;
  }): Record<string, unknown> {
    return {
      paymentTermType: po.paymentTermType,
      netDays: po.netDays,
      termBasis: po.termBasis,
      dueDate: po.dueDate?.toISOString() ?? null,
      obligationAmount: po.obligationAmount?.toString() ?? null,
      obligationCurrency: po.obligationCurrency,
      referenceFxRate: po.referenceFxRate?.toString() ?? null,
      referenceFxBaseCurrency: po.referenceFxBaseCurrency,
      referenceFxQuoteCurrency: po.referenceFxQuoteCurrency,
      referenceFxRateAt: po.referenceFxRateAt?.toISOString() ?? null,
    };
  }

  private toView(row: {
    id: string;
    companyId: string;
    purchaseOrderId: string;
    purchaseOrderItemId: string | null;
    type: PurchaseCorrectionType;
    status: PurchaseCorrectionStatus;
    reason: string;
    beforeSnapshot: Prisma.JsonValue;
    afterSnapshot: Prisma.JsonValue;
    purchaseOrderVersion: number;
    appliedAt: Date;
    createdAt: Date;
    appliedBy: { id: string; firstName: string; lastName: string };
  }): PurchaseOrderCorrectionView {
    return {
      id: row.id,
      companyId: row.companyId,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderItemId: row.purchaseOrderItemId,
      type: row.type,
      status: row.status,
      reason: row.reason,
      beforeSnapshot: row.beforeSnapshot as Record<string, unknown>,
      afterSnapshot: row.afterSnapshot as Record<string, unknown>,
      purchaseOrderVersion: row.purchaseOrderVersion,
      appliedBy: {
        id: row.appliedBy.id,
        displayName: `${row.appliedBy.firstName} ${row.appliedBy.lastName}`.trim(),
      },
      appliedAt: row.appliedAt,
      createdAt: row.createdAt,
    };
  }

  private poNotFound(): never {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_ORDER_NOT_FOUND,
      message: PURCHASE_ORDER_ERROR_MESSAGES.NOT_FOUND,
      statusCode: 404,
    });
  }
}

function unsupported(message: string): never {
  throw new AppError({
    code: ERROR_CODES.PURCHASE_CORRECTION_UNSUPPORTED,
    message: message || PURCHASE_CORRECTION_ERROR_MESSAGES.UNSUPPORTED,
    statusCode: 400,
  });
}

function noChange(): never {
  throw new AppError({
    code: ERROR_CODES.PURCHASE_CORRECTION_NO_CHANGE,
    message: PURCHASE_CORRECTION_ERROR_MESSAGES.NO_CHANGE,
    statusCode: 400,
  });
}
