import { Injectable } from '@nestjs/common';
import {
  CurrencyCode,
  InventoryCostLayerSourceType,
  Prisma,
  PurchaseCostAllocationMethod,
  PurchaseCostAllocationTargetType,
  PurchaseCostStatus,
  PurchaseCostTreatment,
  PurchaseCostType,
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
import type { CompanyContext } from '../companies/types/company.types';
import { ExpensesService } from '../finance/expenses.service';
import {
  PURCHASE_COST_FINANCE_ERROR_MESSAGES,
} from '../finance/finance-expenses.constants';
import {
  allocateByWeights,
  assertAllocationSumExact,
} from '../finance/purchase-cost-allocation-math';
import { JournalPostingService } from '../finance/journal-posting.service';
import { LedgerAccountsService } from '../finance/ledger-accounts.service';
import { postPurchaseCostCapitalizeJournalInTx } from '../finance/journal-builders';
import {
  applyCapitalizableCostToLayersInTx,
  clearUnallocatedPurchaseCostFlagsForPoInTx,
} from '../warehouse/inventory-cost-capitalization';
import { SuppliersService } from './suppliers.service';
import { PurchaseOrderCostsService } from './purchase-order-costs.service';

const TX_OPTIONS = { maxWait: 5_000, timeout: 30_000 } as const;

export type SetPurchaseCostTreatmentDto = {
  treatment: PurchaseCostTreatment;
  /** When PERIOD_EXPENSE, optional category override (defaults by cost type). */
  expenseCategoryId?: string;
  requestId?: string;
};

export type PreviewPurchaseCostAllocationDto = {
  method: PurchaseCostAllocationMethod;
  /** Required for MANUAL. */
  lines?: Array<{ targetType: PurchaseCostAllocationTargetType; targetId: string; amount: string }>;
};

export type AllocatePurchaseCostDto = PreviewPurchaseCostAllocationDto & {
  requestId?: string;
};

export type AllocationPreviewLine = {
  targetType: PurchaseCostAllocationTargetType;
  targetId: string;
  allocatedAmount: string;
  currency: CurrencyCode;
};

@Injectable()
export class PurchaseOrderCostFinanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auditService: AuditService,
    private readonly eventFactory: DomainEventFactory,
    private readonly eventBus: DomainEventBus,
    private readonly suppliersService: SuppliersService,
    private readonly expensesService: ExpensesService,
    private readonly costsService: PurchaseOrderCostsService,
    private readonly journalPosting: JournalPostingService,
    private readonly ledgerAccounts: LedgerAccountsService,
  ) {}

  async setTreatment(
    company: CompanyContext,
    purchaseOrderId: string,
    costId: string,
    dto: SetPurchaseCostTreatmentDto,
  ) {
    const actorUserId = this.suppliersService.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      const result = await this.database.client.$transaction(async (tx) => {
        await this.lockCost(tx, company.companyId, purchaseOrderId, costId);
        const cost = await tx.purchaseOrderCost.findFirst({
          where: { id: costId, companyId: company.companyId, purchaseOrderId },
        });
        if (!cost) this.notFound();
        if (cost!.status !== PurchaseCostStatus.ACTIVE) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_NOT_VOIDABLE,
            message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.NOT_ACTIVE,
            statusCode: 409,
          });
        }
        if (cost!.treatment != null) {
          if (cost!.treatment === dto.treatment) {
            return { cost: cost!, expenseId: cost!.expenseId };
          }
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_TREATMENT_IMMUTABLE,
            message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.TREATMENT_IMMUTABLE,
            statusCode: 409,
          });
        }

        const now = new Date();
        let expenseId: string | null = null;

        if (dto.treatment === PurchaseCostTreatment.PERIOD_EXPENSE) {
          const categoryId =
            dto.expenseCategoryId ??
            (await this.resolveDefaultCategoryId(tx, company.companyId, cost!.type));
          const expense = await this.expensesService.createFromPurchaseOrderCostInTx(tx, {
            companyId: company.companyId,
            actorUserId,
            categoryId,
            amount: cost!.amount,
            currency: cost!.currency,
            expenseDate: cost!.costDate,
            description:
              cost!.description?.trim() ||
              `Purchase cost ${cost!.type} on PO`,
            counterpartyName: cost!.payeeName,
            reference: cost!.reference,
            purchaseOrderCostId: cost!.id,
            requestId: dto.requestId ?? null,
          });
          expenseId = expense.id;
        }

        const updated = await tx.purchaseOrderCost.update({
          where: { id: cost!.id },
          data: {
            treatment: dto.treatment,
            treatmentSetAt: now,
            treatmentSetById: actorUserId,
            financializedAt: now,
            expenseId,
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_COST_TREATMENT_SET,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_COST,
          entityId: updated.id,
          after: {
            treatment: updated.treatment,
            expenseId: updated.expenseId,
          },
        });

        return { cost: updated, expenseId };
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PURCHASE_COST_TREATMENT_SET,
          payload: {
            companyId: company.companyId,
            purchaseOrderId,
            purchaseCostId: costId,
            treatment: dto.treatment,
            expenseId: result.expenseId,
          },
        }),
      );

      return this.costsService.list(company, purchaseOrderId).then((listed) => {
        const row = listed.data.find((c) => c.id === costId);
        if (!row) this.notFound();
        return row!;
      });
    });
  }

  async previewAllocation(
    company: CompanyContext,
    purchaseOrderId: string,
    costId: string,
    dto: PreviewPurchaseCostAllocationDto,
  ): Promise<{ data: AllocationPreviewLine[]; method: PurchaseCostAllocationMethod }> {
    const cost = await this.database.client.purchaseOrderCost.findFirst({
      where: { id: costId, companyId: company.companyId, purchaseOrderId },
    });
    if (!cost) this.notFound();
    const lines = await this.buildAllocationPreview(
      company.companyId,
      purchaseOrderId,
      cost!,
      dto,
    );
    return {
      method: dto.method,
      data: lines.map((l) => ({
        targetType: l.targetType,
        targetId: l.targetId,
        allocatedAmount: l.allocatedAmount.toString(),
        currency: cost!.currency,
      })),
    };
  }

  async allocate(
    company: CompanyContext,
    purchaseOrderId: string,
    costId: string,
    dto: AllocatePurchaseCostDto,
  ) {
    const actorUserId = this.suppliersService.requireActorUserId();
    return commitThenPublish(this.eventBus, async (events) => {
      await this.database.client.$transaction(async (tx) => {
        await this.lockCost(tx, company.companyId, purchaseOrderId, costId);
        const cost = await tx.purchaseOrderCost.findFirst({
          where: { id: costId, companyId: company.companyId, purchaseOrderId },
        });
        if (!cost) this.notFound();
        if (cost!.status !== PurchaseCostStatus.ACTIVE) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_NOT_VOIDABLE,
            message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.NOT_ACTIVE,
            statusCode: 409,
          });
        }
        if (cost!.treatment == null) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_TREATMENT_REQUIRED,
            message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.TREATMENT_REQUIRED,
            statusCode: 409,
          });
        }
        if (cost!.allocatedAt != null) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_ALREADY_ALLOCATED,
            message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.ALREADY_ALLOCATED,
            statusCode: 409,
          });
        }

        const preview = await this.buildAllocationPreview(
          company.companyId,
          purchaseOrderId,
          cost!,
          dto,
          tx,
        );
        try {
          assertAllocationSumExact(
            cost!.amount,
            preview.map((p) => ({ allocatedAmount: p.allocatedAmount })),
          );
        } catch {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_ALLOCATION_SUM_MISMATCH,
            message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.ALLOCATION_SUM_MISMATCH,
            statusCode: 409,
          });
        }

        for (const line of preview) {
          await tx.purchaseCostAllocationLine.create({
            data: {
              companyId: company.companyId,
              purchaseOrderCostId: cost!.id,
              targetType: line.targetType,
              targetId: line.targetId,
              allocatedAmount: line.allocatedAmount,
              currency: cost!.currency,
              createdById: actorUserId,
            },
          });
        }

        if (cost!.treatment === PurchaseCostTreatment.CAPITALIZABLE) {
          await this.applyCapitalization(tx, company.companyId, cost!, preview);
          await postPurchaseCostCapitalizeJournalInTx(
            tx,
            { journals: this.journalPosting, ledger: this.ledgerAccounts },
            {
              companyId: company.companyId,
              actorUserId,
              purchaseOrderCostId: cost!.id,
              amount: cost!.amount,
              currency: cost!.currency,
              effectiveAt: new Date(),
              costLabel: cost!.type,
            },
          );
          events.push(
            this.eventFactory.create({
              type: DOMAIN_EVENTS.PURCHASE_COST_CAPITALIZED,
              payload: {
                companyId: company.companyId,
                purchaseOrderId,
                purchaseCostId: costId,
              },
            }),
          );
          await this.auditService.record(tx, {
            action: AUDIT_ACTIONS.PURCHASE_COST_CAPITALIZED,
            entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_COST,
            entityId: cost!.id,
            after: { lineCount: preview.length },
          });
        }

        await tx.purchaseOrderCost.update({
          where: { id: cost!.id },
          data: {
            allocationMethod: dto.method,
            allocatedAt: new Date(),
          },
        });

        await this.auditService.record(tx, {
          action: AUDIT_ACTIONS.PURCHASE_COST_ALLOCATED,
          entityType: AUDIT_ENTITY_TYPES.PURCHASE_ORDER_COST,
          entityId: cost!.id,
          after: {
            method: dto.method,
            lineCount: preview.length,
            treatment: cost!.treatment,
          },
        });
      }, TX_OPTIONS);

      events.push(
        this.eventFactory.create({
          type: DOMAIN_EVENTS.PURCHASE_COST_ALLOCATED,
          payload: {
            companyId: company.companyId,
            purchaseOrderId,
            purchaseCostId: costId,
            method: dto.method,
          },
        }),
      );

      const listed = await this.costsService.list(company, purchaseOrderId);
      const row = listed.data.find((c) => c.id === costId);
      if (!row) this.notFound();
      return row!;
    });
  }

  private async applyCapitalization(
    tx: Prisma.TransactionClient,
    companyId: string,
    cost: {
      id: string;
      purchaseOrderId: string;
      type: PurchaseCostType;
      amount: Prisma.Decimal;
      currency: CurrencyCode;
    },
    preview: Array<{
      targetType: PurchaseCostAllocationTargetType;
      targetId: string;
      allocatedAmount: Prisma.Decimal;
    }>,
  ): Promise<void> {
    const increments: Array<{
      layerId: string;
      allocatedAmount: Prisma.Decimal;
      currency: CurrencyCode;
      baseAmount: Prisma.Decimal;
      costType: PurchaseCostType;
      sourceId: string;
    }> = [];

    for (const line of preview) {
      let layerIds: string[] = [];
      if (line.targetType === PurchaseCostAllocationTargetType.INVENTORY_COST_LAYER) {
        layerIds = [line.targetId];
      } else if (line.targetType === PurchaseCostAllocationTargetType.GOODS_RECEIPT_ITEM) {
        const layers = await tx.inventoryCostLayer.findMany({
          where: {
            companyId,
            goodsReceiptItemId: line.targetId,
            sourceType: InventoryCostLayerSourceType.GOODS_RECEIPT,
          },
          select: { id: true, originalQuantity: true },
        });
        layerIds = layers.map((l) => l.id);
      } else {
        const layers = await tx.inventoryCostLayer.findMany({
          where: {
            companyId,
            purchaseOrderItemId: line.targetId,
            sourceType: InventoryCostLayerSourceType.GOODS_RECEIPT,
          },
          select: { id: true, originalQuantity: true },
        });
        layerIds = layers.map((l) => l.id);
      }

      if (layerIds.length === 0) {
        throw new AppError({
          code: ERROR_CODES.PURCHASE_COST_CAPITALIZABLE_REQUIRES_LAYERS,
          message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.CAPITALIZABLE_REQUIRES_LAYERS,
          statusCode: 409,
        });
      }

      // Same-currency only in 4.7 — baseAmount = allocatedAmount when currencies match company base later.
      // For IRR company with IRR cost: baseAmount = allocatedAmount.
      // Split across layers by original quantity if multiple layers for one target.
      const layers = await tx.inventoryCostLayer.findMany({
        where: { companyId, id: { in: layerIds } },
        select: { id: true, originalQuantity: true, originalCurrency: true },
      });
      for (const layer of layers) {
        if (
          layer.originalCurrency != null &&
          layer.originalCurrency !== cost.currency
        ) {
          throw new AppError({
            code: ERROR_CODES.PURCHASE_COST_CROSS_CURRENCY,
            message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.CROSS_CURRENCY_COST,
            statusCode: 409,
          });
        }
      }
      const weights = layers.map((l) => ({
        targetId: l.id,
        weight: new Prisma.Decimal(l.originalQuantity),
      }));
      const split = allocateByWeights(line.allocatedAmount, cost.currency, weights);
      for (const s of split) {
        increments.push({
          layerId: s.targetId,
          allocatedAmount: s.allocatedAmount,
          currency: cost.currency,
          baseAmount: s.allocatedAmount,
          costType: cost.type,
          sourceId: cost.id,
        });
      }
    }

    await applyCapitalizableCostToLayersInTx(tx, companyId, increments);

    // If no remaining ACTIVE unallocated capitalizable costs for this PO, clear flags.
    const pending = await tx.purchaseOrderCost.count({
      where: {
        companyId,
        purchaseOrderId: cost.purchaseOrderId,
        status: PurchaseCostStatus.ACTIVE,
        treatment: PurchaseCostTreatment.CAPITALIZABLE,
        allocatedAt: null,
        id: { not: cost.id },
      },
    });
    const unset = await tx.purchaseOrderCost.count({
      where: {
        companyId,
        purchaseOrderId: cost.purchaseOrderId,
        status: PurchaseCostStatus.ACTIVE,
        treatment: null,
      },
    });
    if (pending === 0 && unset === 0) {
      await clearUnallocatedPurchaseCostFlagsForPoInTx(tx, companyId, cost.purchaseOrderId);
    }
  }

  private async buildAllocationPreview(
    companyId: string,
    purchaseOrderId: string,
    cost: { amount: Prisma.Decimal; currency: CurrencyCode },
    dto: PreviewPurchaseCostAllocationDto,
    tx?: Prisma.TransactionClient,
  ): Promise<
    Array<{
      targetType: PurchaseCostAllocationTargetType;
      targetId: string;
      allocatedAmount: Prisma.Decimal;
    }>
  > {
    const client = tx ?? this.database.client;
    if (dto.method === PurchaseCostAllocationMethod.UNALLOCATED) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_COST_ALLOCATION_SUM_MISMATCH,
        message: 'Allocation method must be BY_QUANTITY, BY_VALUE, or MANUAL.',
        statusCode: 400,
      });
    }

    if (dto.method === PurchaseCostAllocationMethod.MANUAL) {
      if (!dto.lines?.length) {
        throw new AppError({
          code: ERROR_CODES.PURCHASE_COST_ALLOCATION_SUM_MISMATCH,
          message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.MANUAL_LINES_REQUIRED,
          statusCode: 400,
        });
      }
      return dto.lines.map((l) => ({
        targetType: l.targetType,
        targetId: l.targetId,
        allocatedAmount: new Prisma.Decimal(l.amount),
      }));
    }

    // Prefer received identity: layers / GR items when present; else PO items (preview).
    const layers = await client.inventoryCostLayer.findMany({
      where: {
        companyId,
        purchaseOrderId,
        sourceType: InventoryCostLayerSourceType.GOODS_RECEIPT,
        remainingQuantity: { gt: 0 },
      },
      select: {
        id: true,
        originalQuantity: true,
        originalUnitAmount: true,
        purchaseOrderItemId: true,
        goodsReceiptItemId: true,
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });

    if (layers.length > 0) {
      const targets = layers.map((l) => ({
        targetId: l.id,
        weight:
          dto.method === PurchaseCostAllocationMethod.BY_QUANTITY
            ? new Prisma.Decimal(l.originalQuantity)
            : (l.originalUnitAmount ?? new Prisma.Decimal(0)).mul(l.originalQuantity),
      }));
      const allocated = allocateByWeights(cost.amount, cost.currency, targets);
      return allocated.map((a) => ({
        targetType: PurchaseCostAllocationTargetType.INVENTORY_COST_LAYER,
        targetId: a.targetId,
        allocatedAmount: a.allocatedAmount,
      }));
    }

    const items = await client.purchaseOrderItem.findMany({
      where: { companyId, purchaseOrderId },
      select: { id: true, quantity: true, unitPrice: true, lineSubtotal: true },
      orderBy: { id: 'asc' },
    });
    if (items.length === 0) {
      throw new AppError({
        code: ERROR_CODES.PURCHASE_COST_ALLOCATION_SUM_MISMATCH,
        message: PURCHASE_COST_FINANCE_ERROR_MESSAGES.TARGETS_REQUIRED,
        statusCode: 409,
      });
    }
    const targets = items.map((i) => ({
      targetId: i.id,
      weight:
        dto.method === PurchaseCostAllocationMethod.BY_QUANTITY
          ? new Prisma.Decimal(i.quantity)
          : i.lineSubtotal,
    }));
    const allocated = allocateByWeights(cost.amount, cost.currency, targets);
    return allocated.map((a) => ({
      targetType: PurchaseCostAllocationTargetType.PURCHASE_ORDER_ITEM,
      targetId: a.targetId,
      allocatedAmount: a.allocatedAmount,
    }));
  }

  private async resolveDefaultCategoryId(
    tx: Prisma.TransactionClient,
    companyId: string,
    type: PurchaseCostType,
  ): Promise<string> {
    const codeMap: Partial<Record<PurchaseCostType, string>> = {
      [PurchaseCostType.COURIER]: 'COURIER',
      [PurchaseCostType.FREIGHT]: 'FREIGHT',
      [PurchaseCostType.PURCHASE_FEE]: 'PURCHASE_FEE',
      [PurchaseCostType.TRANSFER_FEE]: 'BANK_FEE',
      [PurchaseCostType.PACKAGING]: 'PACKAGING',
      [PurchaseCostType.CUSTOMS]: 'CUSTOMS',
      [PurchaseCostType.OTHER]: 'OTHER',
    };
    const code = codeMap[type] ?? 'OTHER';
    const cat = await tx.expenseCategory.findFirst({
      where: { companyId, code },
      select: { id: true },
    });
    if (!cat) {
      throw new AppError({
        code: ERROR_CODES.EXPENSE_CATEGORY_NOT_FOUND,
        message: `Default expense category ${code} not found. Run seed.`,
        statusCode: 409,
      });
    }
    return cat.id;
  }

  private async lockCost(
    tx: Prisma.TransactionClient,
    companyId: string,
    purchaseOrderId: string,
    costId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      SELECT id FROM purchase_order_costs
      WHERE id = ${costId}::uuid
        AND company_id = ${companyId}::uuid
        AND purchase_order_id = ${purchaseOrderId}::uuid
      FOR UPDATE`;
  }

  private notFound(): never {
    throw new AppError({
      code: ERROR_CODES.PURCHASE_COST_NOT_FOUND,
      message: 'Purchase cost was not found.',
      statusCode: 404,
    });
  }
}
