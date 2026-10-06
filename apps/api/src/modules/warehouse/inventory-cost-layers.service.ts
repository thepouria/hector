import { Injectable } from '@nestjs/common';
import {
  InventoryCostLayerSourceType,
  InventoryLayerConsumptionKind,
  InventoryMovementType,
  InventorySourceType,
  InventoryValuationStatus,
  Prisma,
  PurchaseCostAllocationMethod,
  PurchaseCostStatus,
  StockClassification,
} from '@hector/database';
import { createHash } from 'node:crypto';
import { ERROR_CODES } from '../../common/constants';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination-query.dto';
import { AppError } from '../../common/exceptions/app.error';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';
import { COST_LAYER_ERROR_MESSAGES } from './inventory-cost-layers.constants';
import type { InventoryMovementView } from './types/inventory.types';

type Tx = Prisma.TransactionClient;

type PostedForCost = {
  movement: InventoryMovementView;
  /** True when this call created the movement (not idempotent replay). */
  created: boolean;
};

/**
 * Warehouse-scoped FIFO cost layers (Phase 3.15).
 *
 * Scope decision: FIFO pools are Company + Warehouse + SKU + Classification.
 * Location moves do not create/reset layers. Warehouse transfer / reclassify
 * move provenance (TRANSFER_OUT/RECLASSIFY_OUT → destination layers).
 *
 * Acquisition cost foundation = PO item unitPrice (+ FX reference → base).
 * Unallocated purchase costs ⇒ PARTIALLY_VALUED (never invent landed allocation).
 * Unknown cost ⇒ UNVALUED (never fake 0).
 */
@Injectable()
export class InventoryCostLayersService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Sync cost layers for movements just posted in the same transaction.
   * Idempotent: existing consumptions / layers for the movement source skip work.
   */
  async syncForPostedMovementsInTx(
    tx: Tx,
    companyId: string,
    posted: PostedForCost[],
  ): Promise<void> {
    const created = posted.filter((p) => p.created).map((p) => p.movement);
    if (created.length === 0) return;

    // Pair transfer/reclassify legs by operationId + sourceLineId before solo processing.
    const pairedOutIds = new Set<string>();
    const byPairKey = new Map<string, InventoryMovementView[]>();
    for (const m of created) {
      if (
        (m.movementType === InventoryMovementType.TRANSFER_OUT ||
          m.movementType === InventoryMovementType.TRANSFER_IN ||
          m.movementType === InventoryMovementType.RECLASSIFY_OUT ||
          m.movementType === InventoryMovementType.RECLASSIFY_IN) &&
        m.operationId
      ) {
        const key = `${m.operationId}:${m.sourceLineId}`;
        const list = byPairKey.get(key) ?? [];
        list.push(m);
        byPairKey.set(key, list);
      }
    }

    for (const [, legs] of byPairKey) {
      const out = legs.find(
        (m) =>
          m.movementType === InventoryMovementType.TRANSFER_OUT ||
          m.movementType === InventoryMovementType.RECLASSIFY_OUT,
      );
      const inn = legs.find(
        (m) =>
          m.movementType === InventoryMovementType.TRANSFER_IN ||
          m.movementType === InventoryMovementType.RECLASSIFY_IN,
      );
      if (out && inn) {
        await this.moveProvenanceInTx(tx, companyId, out, inn);
        pairedOutIds.add(out.id);
        pairedOutIds.add(inn.id);
      }
    }

    for (const m of created) {
      if (pairedOutIds.has(m.id)) continue;
      if (m.quantityDelta > 0) {
        await this.createInboundLayerInTx(tx, companyId, m);
      } else if (m.quantityDelta < 0) {
        await this.consumeOutboundInTx(tx, companyId, m);
      }
    }
  }

  async listLayers(
    company: CompanyContext,
    query: {
      page?: number;
      pageSize?: number;
      warehouseId?: string;
      skuId?: string;
      batchId?: string;
      classification?: StockClassification;
      valuationStatus?: InventoryValuationStatus;
      remainingOnly?: boolean;
    },
  ): Promise<{ data: unknown[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.InventoryCostLayerWhereInput = {
      companyId: company.companyId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.skuId ? { skuId: query.skuId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.classification ? { classification: query.classification } : {}),
      ...(query.valuationStatus ? { valuationStatus: query.valuationStatus } : {}),
      ...(query.remainingOnly ? { remainingQuantity: { gt: 0 } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.database.client.inventoryCostLayer.findMany({
        where,
        orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          sku: { select: { id: true, code: true, name: true } },
          batch: { select: { id: true, batchNumber: true } },
        },
      }),
      this.database.client.inventoryCostLayer.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.toLayerView(r)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getLayer(company: CompanyContext, layerId: string) {
    const row = await this.database.client.inventoryCostLayer.findFirst({
      where: { id: layerId, companyId: company.companyId },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        sku: { select: { id: true, code: true, name: true } },
        batch: { select: { id: true, batchNumber: true } },
        consumptions: {
          orderBy: { createdAt: 'asc' },
          include: {
            movement: {
              select: {
                id: true,
                movementType: true,
                quantityDelta: true,
                occurredAt: true,
                sourceType: true,
                sourceId: true,
              },
            },
          },
        },
      },
    });
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_COST_LAYER_NOT_FOUND,
        message: COST_LAYER_ERROR_MESSAGES.LAYER_NOT_FOUND,
        statusCode: 404,
      });
    }
    return {
      ...this.toLayerView(row),
      consumptions: row.consumptions.map((c) => ({
        id: c.id,
        inventoryMovementId: c.inventoryMovementId,
        kind: c.kind,
        quantity: c.quantity,
        unitCost: c.unitCost?.toString() ?? null,
        totalCost: c.totalCost?.toString() ?? null,
        valuationStatus: c.valuationStatus,
        destinationLayerId: c.destinationLayerId,
        createdAt: c.createdAt.toISOString(),
        movement: c.movement,
      })),
    };
  }

  async getMovementCostTrace(company: CompanyContext, movementId: string) {
    const movement = await this.database.client.inventoryMovement.findFirst({
      where: { id: movementId, companyId: company.companyId },
      select: {
        id: true,
        movementType: true,
        quantityDelta: true,
        skuId: true,
        warehouseId: true,
        classification: true,
        occurredAt: true,
      },
    });
    if (!movement) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_MOVEMENT_NOT_FOUND,
        message: 'Inventory movement not found',
        statusCode: 404,
      });
    }
    const consumptions = await this.database.client.inventoryLayerConsumption.findMany({
      where: { companyId: company.companyId, inventoryMovementId: movementId },
      orderBy: { createdAt: 'asc' },
      include: {
        costLayer: {
          select: {
            id: true,
            valuationStatus: true,
            originalCurrency: true,
            originalUnitAmount: true,
            referenceFxRate: true,
            baseCurrencyUnitCost: true,
            purchaseOrderItemId: true,
            receivedAt: true,
          },
        },
      },
    });
    let valuedQty = 0;
    let unvaluedQty = 0;
    let inventoryCost = new Prisma.Decimal(0);
    for (const c of consumptions) {
      if (c.valuationStatus === InventoryValuationStatus.UNVALUED || c.totalCost == null) {
        unvaluedQty += c.quantity;
      } else {
        valuedQty += c.quantity;
        inventoryCost = inventoryCost.add(c.totalCost);
      }
    }
    const completeness =
      unvaluedQty === 0 && valuedQty > 0
        ? InventoryValuationStatus.VALUED
        : valuedQty === 0 && unvaluedQty > 0
          ? InventoryValuationStatus.UNVALUED
          : valuedQty > 0 && unvaluedQty > 0
            ? InventoryValuationStatus.PARTIALLY_VALUED
            : InventoryValuationStatus.UNVALUED;

    return {
      movement,
      consumptions: consumptions.map((c) => ({
        id: c.id,
        costLayerId: c.costLayerId,
        kind: c.kind,
        quantity: c.quantity,
        unitCost: c.unitCost?.toString() ?? null,
        totalCost: c.totalCost?.toString() ?? null,
        valuationStatus: c.valuationStatus,
        destinationLayerId: c.destinationLayerId,
        costLayer: {
          ...c.costLayer,
          originalUnitAmount: c.costLayer.originalUnitAmount?.toString() ?? null,
          referenceFxRate: c.costLayer.referenceFxRate?.toString() ?? null,
          baseCurrencyUnitCost: c.costLayer.baseCurrencyUnitCost?.toString() ?? null,
        },
      })),
      summary: {
        consumedQuantity: Math.abs(movement.quantityDelta),
        valuedConsumedQuantity: valuedQty,
        unvaluedConsumedQuantity: unvaluedQty,
        inventoryCost: inventoryCost.toString(),
        valuationCompleteness: completeness,
        /** Phase 3.15: inventory cost consumption — NOT COGS. */
        terminology: 'INVENTORY_COST_CONSUMPTION' as const,
      },
    };
  }

  private async createInboundLayerInTx(
    tx: Tx,
    companyId: string,
    movement: InventoryMovementView,
  ): Promise<void> {
    if (movement.movementType === InventoryMovementType.RECEIVE) {
      await this.createReceiveLayerInTx(tx, companyId, movement);
      return;
    }
    if (
      movement.movementType === InventoryMovementType.ADJUSTMENT_IN ||
      movement.movementType === InventoryMovementType.STOCK_COUNT_ADJUSTMENT_IN ||
      movement.movementType === InventoryMovementType.OPENING_BALANCE ||
      movement.movementType === InventoryMovementType.RETURN_IN ||
      movement.movementType === InventoryMovementType.SYSTEM_CORRECTION
    ) {
      const sourceType =
        movement.movementType === InventoryMovementType.STOCK_COUNT_ADJUSTMENT_IN
          ? InventoryCostLayerSourceType.STOCK_COUNT_ADJUSTMENT_IN
          : movement.movementType === InventoryMovementType.ADJUSTMENT_IN
            ? InventoryCostLayerSourceType.ADJUSTMENT_IN
            : movement.movementType === InventoryMovementType.OPENING_BALANCE
              ? InventoryCostLayerSourceType.OPENING_BALANCE
              : InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP;

      await this.ensureLayerInTx(tx, {
        companyId,
        warehouseId: movement.warehouseId,
        skuId: movement.skuId,
        batchId: movement.batchId,
        classification: movement.classification,
        sourceType,
        sourceId: movement.sourceId,
        sourceLineId: movement.sourceLineId,
        receivedAt: new Date(movement.occurredAt),
        quantity: movement.quantityDelta,
        valuationStatus: InventoryValuationStatus.UNVALUED,
        originalCurrency: null,
        originalUnitAmount: null,
        referenceFxRate: null,
        baseCurrencyUnitCost: null,
        hasUnallocatedPurchaseCosts: false,
      });
    }
  }

  private async createReceiveLayerInTx(
    tx: Tx,
    companyId: string,
    movement: InventoryMovementView,
  ): Promise<void> {
    if (movement.sourceType !== InventorySourceType.PUTAWAY) {
      // Seed / non-putaway RECEIVE → UNVALUED unless already created.
      await this.ensureLayerInTx(tx, {
        companyId,
        warehouseId: movement.warehouseId,
        skuId: movement.skuId,
        batchId: movement.batchId,
        classification: movement.classification,
        sourceType: InventoryCostLayerSourceType.SEED,
        sourceId: movement.sourceId,
        sourceLineId: movement.sourceLineId,
        receivedAt: new Date(movement.occurredAt),
        quantity: movement.quantityDelta,
        valuationStatus: InventoryValuationStatus.UNVALUED,
        originalCurrency: null,
        originalUnitAmount: null,
        referenceFxRate: null,
        baseCurrencyUnitCost: null,
        hasUnallocatedPurchaseCosts: false,
      });
      return;
    }

    const putawayItem = await tx.putawayItem.findFirst({
      where: { id: movement.sourceLineId, companyId },
      include: {
        goodsReceiptItemBatch: {
          include: {
            goodsReceiptItem: {
              include: {
                goodsReceipt: true,
                purchaseOrderItem: {
                  include: {
                    purchaseOrder: {
                      include: {
                        costs: {
                          where: { status: PurchaseCostStatus.ACTIVE },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!putawayItem) {
      await this.ensureLayerInTx(tx, {
        companyId,
        warehouseId: movement.warehouseId,
        skuId: movement.skuId,
        batchId: movement.batchId,
        classification: movement.classification,
        sourceType: InventoryCostLayerSourceType.GOODS_RECEIPT,
        sourceId: movement.sourceId,
        sourceLineId: movement.sourceLineId,
        receivedAt: new Date(movement.occurredAt),
        quantity: movement.quantityDelta,
        valuationStatus: InventoryValuationStatus.UNVALUED,
        originalCurrency: null,
        originalUnitAmount: null,
        referenceFxRate: null,
        baseCurrencyUnitCost: null,
        hasUnallocatedPurchaseCosts: false,
      });
      return;
    }

    const gri = putawayItem.goodsReceiptItemBatch.goodsReceiptItem;
    const poi = gri.purchaseOrderItem;
    const po = poi.purchaseOrder;
    const unitPrice = poi.unitPrice;
    const hasUnallocated = po.costs.some(
      (c) => c.allocationMethod === PurchaseCostAllocationMethod.UNALLOCATED,
    );

    let baseUnit: Prisma.Decimal;
    let referenceFxRate: Prisma.Decimal | null = null;
    if (po.currency === 'IRR') {
      baseUnit = unitPrice;
    } else if (po.referenceFxRate != null) {
      referenceFxRate = po.referenceFxRate;
      baseUnit = unitPrice.mul(po.referenceFxRate);
    } else {
      // FX without reference rate → cannot form base valuation confidently.
      await this.ensureLayerInTx(tx, {
        companyId,
        warehouseId: movement.warehouseId,
        skuId: movement.skuId,
        batchId: movement.batchId,
        classification: movement.classification,
        sourceType: InventoryCostLayerSourceType.GOODS_RECEIPT,
        sourceId: gri.goodsReceiptId,
        sourceLineId: movement.sourceLineId,
        purchaseOrderId: po.id,
        purchaseOrderItemId: poi.id,
        goodsReceiptId: gri.goodsReceiptId,
        goodsReceiptItemId: gri.id,
        receivedAt: new Date(movement.occurredAt),
        quantity: movement.quantityDelta,
        valuationStatus: InventoryValuationStatus.UNVALUED,
        originalCurrency: po.currency,
        originalUnitAmount: unitPrice,
        referenceFxRate: null,
        baseCurrencyUnitCost: null,
        hasUnallocatedPurchaseCosts: hasUnallocated,
      });
      return;
    }

    const valuationStatus = hasUnallocated
      ? InventoryValuationStatus.PARTIALLY_VALUED
      : InventoryValuationStatus.VALUED;

    await this.ensureLayerInTx(tx, {
      companyId,
      warehouseId: movement.warehouseId,
      skuId: movement.skuId,
      batchId: movement.batchId,
      classification: movement.classification,
      sourceType: InventoryCostLayerSourceType.GOODS_RECEIPT,
      sourceId: gri.goodsReceiptId,
      sourceLineId: movement.sourceLineId,
      purchaseOrderId: po.id,
      purchaseOrderItemId: poi.id,
      goodsReceiptId: gri.goodsReceiptId,
      goodsReceiptItemId: gri.id,
      receivedAt: new Date(movement.occurredAt),
      quantity: movement.quantityDelta,
      valuationStatus,
      originalCurrency: po.currency,
      originalUnitAmount: unitPrice,
      referenceFxRate,
      baseCurrencyUnitCost: baseUnit,
      hasUnallocatedPurchaseCosts: hasUnallocated,
    });
  }

  private async consumeOutboundInTx(
    tx: Tx,
    companyId: string,
    movement: InventoryMovementView,
  ): Promise<void> {
    const existing = await tx.inventoryLayerConsumption.count({
      where: { companyId, inventoryMovementId: movement.id },
    });
    if (existing > 0) return;

    const qty = Math.abs(movement.quantityDelta);
    const kind = this.kindForMovement(movement.movementType);
    let preferPurchaseOrderItemId: string | undefined;

    if (
      movement.movementType === InventoryMovementType.RETURN_OUT &&
      movement.sourceType === InventorySourceType.SUPPLIER_RETURN
    ) {
      const execItem = await tx.supplierReturnExecutionItem.findFirst({
        where: { id: movement.sourceLineId, companyId },
        include: {
          returnItem: { select: { purchaseOrderItemId: true } },
        },
      });
      preferPurchaseOrderItemId =
        execItem?.returnItem.purchaseOrderItemId ?? undefined;
    }

    await this.consumeLayersInTx(tx, {
      companyId,
      warehouseId: movement.warehouseId,
      skuId: movement.skuId,
      classification: movement.classification,
      quantity: qty,
      movementId: movement.id,
      kind,
      preferPurchaseOrderItemId,
      createDestination: null,
    });
  }

  private async moveProvenanceInTx(
    tx: Tx,
    companyId: string,
    out: InventoryMovementView,
    inn: InventoryMovementView,
  ): Promise<void> {
    const existing = await tx.inventoryLayerConsumption.count({
      where: { companyId, inventoryMovementId: out.id },
    });
    if (existing > 0) return;

    const kind =
      out.movementType === InventoryMovementType.RECLASSIFY_OUT
        ? InventoryLayerConsumptionKind.RECLASSIFY_OUT
        : InventoryLayerConsumptionKind.TRANSFER_OUT;

    await this.consumeLayersInTx(tx, {
      companyId,
      warehouseId: out.warehouseId,
      skuId: out.skuId,
      classification: out.classification,
      quantity: Math.abs(out.quantityDelta),
      movementId: out.id,
      kind,
      preferPurchaseOrderItemId: undefined,
      createDestination: {
        warehouseId: inn.warehouseId,
        classification: inn.classification,
        batchId: inn.batchId,
        sourceId: inn.sourceId,
        receivedAt: new Date(inn.occurredAt),
        inMovementId: inn.id,
        destSourceType:
          out.movementType === InventoryMovementType.RECLASSIFY_OUT
            ? InventoryCostLayerSourceType.RECLASSIFY_IN
            : InventoryCostLayerSourceType.TRANSFER_IN,
      },
    });
  }

  private async consumeLayersInTx(
    tx: Tx,
    input: {
      companyId: string;
      warehouseId: string;
      skuId: string;
      classification: StockClassification;
      quantity: number;
      movementId: string;
      kind: InventoryLayerConsumptionKind;
      preferPurchaseOrderItemId?: string;
      createDestination: null | {
        warehouseId: string;
        classification: StockClassification;
        batchId: string;
        sourceId: string;
        receivedAt: Date;
        inMovementId: string;
        destSourceType: InventoryCostLayerSourceType;
      };
    },
  ): Promise<void> {
    let remaining = input.quantity;

    const lockOrder = Prisma.sql`
      SELECT id FROM inventory_cost_layers
      WHERE company_id = ${input.companyId}::uuid
        AND warehouse_id = ${input.warehouseId}::uuid
        AND sku_id = ${input.skuId}::uuid
        AND classification = ${input.classification}::"stock_classification"
        AND remaining_quantity > 0
      ORDER BY received_at ASC, id ASC
      FOR UPDATE
    `;
    await tx.$queryRaw(lockOrder);

    const layers = await tx.inventoryCostLayer.findMany({
      where: {
        companyId: input.companyId,
        warehouseId: input.warehouseId,
        skuId: input.skuId,
        classification: input.classification,
        remainingQuantity: { gt: 0 },
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    });

    // Provenance-first for supplier returns, then FIFO for the rest.
    const ordered = [...layers];
    if (input.preferPurchaseOrderItemId) {
      ordered.sort((a, b) => {
        const aMatch = a.purchaseOrderItemId === input.preferPurchaseOrderItemId ? 0 : 1;
        const bMatch = b.purchaseOrderItemId === input.preferPurchaseOrderItemId ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
        const t = a.receivedAt.getTime() - b.receivedAt.getTime();
        if (t !== 0) return t;
        return a.id.localeCompare(b.id);
      });
    }

    for (const layer of ordered) {
      if (remaining <= 0) break;
      const take = Math.min(layer.remainingQuantity, remaining);
      if (take <= 0) continue;

      const isUnvalued = layer.valuationStatus === InventoryValuationStatus.UNVALUED;
      const unitCost = isUnvalued ? null : layer.baseCurrencyUnitCost;
      const totalCost =
        unitCost == null ? null : unitCost.mul(new Prisma.Decimal(take));

      let destinationLayerId: string | null = null;
      if (input.createDestination) {
        destinationLayerId = deterministicUuid(
          `${input.createDestination.destSourceType}:${input.createDestination.inMovementId}:${layer.id}`,
        );
        await tx.inventoryCostLayer.create({
          data: {
            id: destinationLayerId,
            companyId: input.companyId,
            warehouseId: input.createDestination.warehouseId,
            skuId: input.skuId,
            batchId: input.createDestination.batchId,
            classification: input.createDestination.classification,
            sourceType: input.createDestination.destSourceType,
            sourceId: input.createDestination.sourceId,
            sourceLineId: destinationLayerId,
            purchaseOrderId: layer.purchaseOrderId,
            purchaseOrderItemId: layer.purchaseOrderItemId,
            goodsReceiptId: layer.goodsReceiptId,
            goodsReceiptItemId: layer.goodsReceiptItemId,
            parentLayerId: layer.id,
            receivedAt: layer.receivedAt,
            originalQuantity: take,
            remainingQuantity: take,
            valuationStatus: layer.valuationStatus,
            originalCurrency: layer.originalCurrency,
            originalUnitAmount: layer.originalUnitAmount,
            referenceFxRate: layer.referenceFxRate,
            baseCurrencyUnitCost: layer.baseCurrencyUnitCost,
            hasUnallocatedPurchaseCosts: layer.hasUnallocatedPurchaseCosts,
          },
        });
      }

      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: { remainingQuantity: layer.remainingQuantity - take },
      });

      await tx.inventoryLayerConsumption.create({
        data: {
          companyId: input.companyId,
          inventoryMovementId: input.movementId,
          costLayerId: layer.id,
          kind: input.kind,
          quantity: take,
          unitCost,
          totalCost,
          valuationStatus: isUnvalued
            ? InventoryValuationStatus.UNVALUED
            : layer.valuationStatus === InventoryValuationStatus.PARTIALLY_VALUED
              ? InventoryValuationStatus.PARTIALLY_VALUED
              : InventoryValuationStatus.VALUED,
          destinationLayerId,
        },
      });

      remaining -= take;
    }

    if (remaining > 0) {
      // Physical stock existed but layers missing — consume via ephemeral UNVALUED bootstrap
      // only when layers are short (never block warehouse ops solely for missing cost).
      const bootstrapId = deterministicUuid(
        `bootstrap-consume:${input.movementId}:${remaining}`,
      );
      const bootstrap = await tx.inventoryCostLayer.create({
        data: {
          id: bootstrapId,
          companyId: input.companyId,
          warehouseId: input.warehouseId,
          skuId: input.skuId,
          batchId: null,
          classification: input.classification,
          sourceType: InventoryCostLayerSourceType.SYSTEM_BOOTSTRAP,
          sourceId: input.movementId,
          sourceLineId: bootstrapId,
          receivedAt: new Date(0),
          originalQuantity: remaining,
          remainingQuantity: 0,
          valuationStatus: InventoryValuationStatus.UNVALUED,
        },
      });

      let destinationLayerId: string | null = null;
      if (input.createDestination) {
        destinationLayerId = deterministicUuid(
          `${input.createDestination.destSourceType}:${input.createDestination.inMovementId}:${bootstrap.id}`,
        );
        await tx.inventoryCostLayer.create({
          data: {
            id: destinationLayerId,
            companyId: input.companyId,
            warehouseId: input.createDestination.warehouseId,
            skuId: input.skuId,
            batchId: input.createDestination.batchId,
            classification: input.createDestination.classification,
            sourceType: input.createDestination.destSourceType,
            sourceId: input.createDestination.sourceId,
            sourceLineId: destinationLayerId,
            parentLayerId: bootstrap.id,
            receivedAt: new Date(0),
            originalQuantity: remaining,
            remainingQuantity: remaining,
            valuationStatus: InventoryValuationStatus.UNVALUED,
          },
        });
      }

      await tx.inventoryLayerConsumption.create({
        data: {
          companyId: input.companyId,
          inventoryMovementId: input.movementId,
          costLayerId: bootstrap.id,
          kind: input.kind,
          quantity: remaining,
          unitCost: null,
          totalCost: null,
          valuationStatus: InventoryValuationStatus.UNVALUED,
          destinationLayerId,
        },
      });
    }
  }

  private async ensureLayerInTx(
    tx: Tx,
    data: {
      companyId: string;
      warehouseId: string;
      skuId: string;
      batchId: string | null;
      classification: StockClassification;
      sourceType: InventoryCostLayerSourceType;
      sourceId: string;
      sourceLineId: string;
      purchaseOrderId?: string | null;
      purchaseOrderItemId?: string | null;
      goodsReceiptId?: string | null;
      goodsReceiptItemId?: string | null;
      parentLayerId?: string | null;
      receivedAt: Date;
      quantity: number;
      valuationStatus: InventoryValuationStatus;
      originalCurrency: Prisma.InventoryCostLayerCreateInput['originalCurrency'] | null;
      originalUnitAmount: Prisma.Decimal | null;
      referenceFxRate: Prisma.Decimal | null;
      baseCurrencyUnitCost: Prisma.Decimal | null;
      hasUnallocatedPurchaseCosts: boolean;
    },
  ): Promise<void> {
    if (!Number.isInteger(data.quantity) || data.quantity <= 0) {
      throw new AppError({
        code: ERROR_CODES.INVENTORY_COST_LAYER_INVALID_QUANTITY,
        message: COST_LAYER_ERROR_MESSAGES.INVALID_QUANTITY,
        statusCode: 400,
      });
    }
    const existing = await tx.inventoryCostLayer.findUnique({
      where: {
        companyId_sourceType_sourceLineId: {
          companyId: data.companyId,
          sourceType: data.sourceType,
          sourceLineId: data.sourceLineId,
        },
      },
    });
    if (existing) return;

    await tx.inventoryCostLayer.create({
      data: {
        companyId: data.companyId,
        warehouseId: data.warehouseId,
        skuId: data.skuId,
        batchId: data.batchId,
        classification: data.classification,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        sourceLineId: data.sourceLineId,
        purchaseOrderId: data.purchaseOrderId ?? null,
        purchaseOrderItemId: data.purchaseOrderItemId ?? null,
        goodsReceiptId: data.goodsReceiptId ?? null,
        goodsReceiptItemId: data.goodsReceiptItemId ?? null,
        parentLayerId: data.parentLayerId ?? null,
        receivedAt: data.receivedAt,
        originalQuantity: data.quantity,
        remainingQuantity: data.quantity,
        valuationStatus: data.valuationStatus,
        originalCurrency: data.originalCurrency ?? null,
        originalUnitAmount: data.originalUnitAmount,
        referenceFxRate: data.referenceFxRate,
        baseCurrencyUnitCost: data.baseCurrencyUnitCost,
        hasUnallocatedPurchaseCosts: data.hasUnallocatedPurchaseCosts,
      },
    });
  }

  private kindForMovement(type: InventoryMovementType): InventoryLayerConsumptionKind {
    switch (type) {
      case InventoryMovementType.ISSUE:
        return InventoryLayerConsumptionKind.ISSUE;
      case InventoryMovementType.ADJUSTMENT_OUT:
        return InventoryLayerConsumptionKind.ADJUSTMENT_OUT;
      case InventoryMovementType.STOCK_COUNT_ADJUSTMENT_OUT:
        return InventoryLayerConsumptionKind.STOCK_COUNT_ADJUSTMENT_OUT;
      case InventoryMovementType.RETURN_OUT:
        return InventoryLayerConsumptionKind.RETURN_OUT;
      case InventoryMovementType.TRANSFER_OUT:
        return InventoryLayerConsumptionKind.TRANSFER_OUT;
      case InventoryMovementType.RECLASSIFY_OUT:
        return InventoryLayerConsumptionKind.RECLASSIFY_OUT;
      default:
        return InventoryLayerConsumptionKind.ISSUE;
    }
  }

  private toLayerView(row: {
    id: string;
    companyId: string;
    warehouseId: string;
    skuId: string;
    batchId: string | null;
    classification: StockClassification;
    sourceType: InventoryCostLayerSourceType;
    sourceId: string;
    sourceLineId: string;
    purchaseOrderId: string | null;
    purchaseOrderItemId: string | null;
    goodsReceiptId: string | null;
    goodsReceiptItemId: string | null;
    parentLayerId: string | null;
    receivedAt: Date;
    originalQuantity: number;
    remainingQuantity: number;
    valuationStatus: InventoryValuationStatus;
    originalCurrency: string | null;
    originalUnitAmount: Prisma.Decimal | null;
    referenceFxRate: Prisma.Decimal | null;
    baseCurrencyUnitCost: Prisma.Decimal | null;
    hasUnallocatedPurchaseCosts: boolean;
    createdAt: Date;
    updatedAt: Date;
    warehouse?: { id: string; code: string; name: string };
    sku?: { id: string; code: string; name: string | null };
    batch?: { id: string; batchNumber: string } | null;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      warehouseId: row.warehouseId,
      skuId: row.skuId,
      batchId: row.batchId,
      classification: row.classification,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceLineId: row.sourceLineId,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderItemId: row.purchaseOrderItemId,
      goodsReceiptId: row.goodsReceiptId,
      goodsReceiptItemId: row.goodsReceiptItemId,
      parentLayerId: row.parentLayerId,
      receivedAt: row.receivedAt.toISOString(),
      originalQuantity: row.originalQuantity,
      remainingQuantity: row.remainingQuantity,
      valuationStatus: row.valuationStatus,
      originalCurrency: row.originalCurrency,
      originalUnitAmount: row.originalUnitAmount?.toString() ?? null,
      referenceFxRate: row.referenceFxRate?.toString() ?? null,
      baseCurrencyUnitCost: row.baseCurrencyUnitCost?.toString() ?? null,
      hasUnallocatedPurchaseCosts: row.hasUnallocatedPurchaseCosts,
      remainingValue:
        row.baseCurrencyUnitCost != null
          ? row.baseCurrencyUnitCost.mul(row.remainingQuantity).toString()
          : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      warehouse: row.warehouse,
      sku: row.sku,
      batch: row.batch ?? null,
    };
  }
}

function deterministicUuid(seed: string): string {
  const hash = createHash('sha256').update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
