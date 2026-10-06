import { Injectable } from '@nestjs/common';
import {
  InventoryValuationStatus,
  Prisma,
  StockClassification,
} from '@hector/database';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { CompanyContext } from '../companies/types/company.types';

/**
 * Inventory valuation read models (Phase 3.15).
 * Value = SUM(remainingQuantity × baseCurrencyUnitCost) for non-UNVALUED layers.
 * Reservation does NOT reduce owned inventory value.
 */
@Injectable()
export class InventoryValuationService {
  constructor(private readonly database: DatabaseService) {}

  async summary(company: CompanyContext) {
    const layers = await this.database.client.inventoryCostLayer.findMany({
      where: {
        companyId: company.companyId,
        remainingQuantity: { gt: 0 },
      },
      select: {
        remainingQuantity: true,
        valuationStatus: true,
        baseCurrencyUnitCost: true,
      },
    });

    let totalValue = new Prisma.Decimal(0);
    let valuedQuantity = 0;
    let unvaluedQuantity = 0;
    let partiallyValuedQuantity = 0;

    for (const layer of layers) {
      if (layer.valuationStatus === InventoryValuationStatus.UNVALUED) {
        unvaluedQuantity += layer.remainingQuantity;
        continue;
      }
      if (layer.baseCurrencyUnitCost == null) {
        unvaluedQuantity += layer.remainingQuantity;
        continue;
      }
      if (layer.valuationStatus === InventoryValuationStatus.PARTIALLY_VALUED) {
        partiallyValuedQuantity += layer.remainingQuantity;
      } else {
        valuedQuantity += layer.remainingQuantity;
      }
      totalValue = totalValue.add(
        layer.baseCurrencyUnitCost.mul(layer.remainingQuantity),
      );
    }

    const completeness =
      unvaluedQuantity === 0 && partiallyValuedQuantity === 0
        ? InventoryValuationStatus.VALUED
        : unvaluedQuantity > 0 && valuedQuantity === 0 && partiallyValuedQuantity === 0
          ? InventoryValuationStatus.UNVALUED
          : InventoryValuationStatus.PARTIALLY_VALUED;

    return {
      totalInventoryValue: totalValue.toString(),
      valuedQuantity,
      partiallyValuedQuantity,
      unvaluedQuantity,
      valuationCompleteness: completeness,
      note: 'Reservation does not reduce owned inventory value. Inventory cost ≠ COGS/Profit.',
    };
  }

  async byWarehouse(company: CompanyContext) {
    const rows = await this.database.client.$queryRaw<
      Array<{
        warehouse_id: string;
        code: string;
        name: string;
        valued_qty: bigint;
        unvalued_qty: bigint;
        total_value: string | null;
      }>
    >`
      SELECT
        w.id AS warehouse_id,
        w.code,
        w.name,
        COALESCE(SUM(CASE WHEN l.valuation_status <> 'UNVALUED' AND l.base_currency_unit_cost IS NOT NULL
          THEN l.remaining_quantity ELSE 0 END), 0) AS valued_qty,
        COALESCE(SUM(CASE WHEN l.valuation_status = 'UNVALUED' OR l.base_currency_unit_cost IS NULL
          THEN l.remaining_quantity ELSE 0 END), 0) AS unvalued_qty,
        COALESCE(SUM(CASE WHEN l.base_currency_unit_cost IS NOT NULL
          THEN l.remaining_quantity * l.base_currency_unit_cost ELSE 0 END), 0)::text AS total_value
      FROM warehouses w
      LEFT JOIN inventory_cost_layers l
        ON l.warehouse_id = w.id
       AND l.company_id = w.company_id
       AND l.remaining_quantity > 0
      WHERE w.company_id = ${company.companyId}::uuid
        AND w.is_system = false
      GROUP BY w.id, w.code, w.name
      ORDER BY w.code ASC
    `;

    return {
      data: rows.map((r) => ({
        warehouseId: r.warehouse_id,
        code: r.code,
        name: r.name,
        valuedQuantity: Number(r.valued_qty),
        unvaluedQuantity: Number(r.unvalued_qty),
        totalValue: r.total_value ?? '0',
      })),
    };
  }

  async bySku(company: CompanyContext, warehouseId?: string) {
    const rows = await this.database.client.$queryRaw<
      Array<{
        sku_id: string;
        code: string;
        name: string | null;
        product_name: string;
        valued_qty: bigint;
        unvalued_qty: bigint;
        total_value: string | null;
      }>
    >`
      SELECT
        s.id AS sku_id,
        s.code,
        s.name,
        p.name AS product_name,
        COALESCE(SUM(CASE WHEN l.valuation_status <> 'UNVALUED' AND l.base_currency_unit_cost IS NOT NULL
          THEN l.remaining_quantity ELSE 0 END), 0) AS valued_qty,
        COALESCE(SUM(CASE WHEN l.valuation_status = 'UNVALUED' OR l.base_currency_unit_cost IS NULL
          THEN l.remaining_quantity ELSE 0 END), 0) AS unvalued_qty,
        COALESCE(SUM(CASE WHEN l.base_currency_unit_cost IS NOT NULL
          THEN l.remaining_quantity * l.base_currency_unit_cost ELSE 0 END), 0)::text AS total_value
      FROM inventory_cost_layers l
      JOIN skus s ON s.id = l.sku_id AND s.company_id = l.company_id
      JOIN products p ON p.id = s.product_id AND p.company_id = s.company_id
      WHERE l.company_id = ${company.companyId}::uuid
        AND l.remaining_quantity > 0
        ${warehouseId ? Prisma.sql`AND l.warehouse_id = ${warehouseId}::uuid` : Prisma.empty}
      GROUP BY s.id, s.code, s.name, p.name
      ORDER BY s.code ASC
      LIMIT 500
    `;

    return {
      data: rows.map((r) => ({
        skuId: r.sku_id,
        code: r.code,
        name: r.name,
        productName: r.product_name,
        valuedQuantity: Number(r.valued_qty),
        unvaluedQuantity: Number(r.unvalued_qty),
        totalValue: r.total_value ?? '0',
      })),
    };
  }

  async byClassification(company: CompanyContext, warehouseId?: string) {
    const rows = await this.database.client.$queryRaw<
      Array<{
        classification: StockClassification;
        valued_qty: bigint;
        unvalued_qty: bigint;
        total_value: string | null;
      }>
    >`
      SELECT
        l.classification,
        COALESCE(SUM(CASE WHEN l.valuation_status <> 'UNVALUED' AND l.base_currency_unit_cost IS NOT NULL
          THEN l.remaining_quantity ELSE 0 END), 0) AS valued_qty,
        COALESCE(SUM(CASE WHEN l.valuation_status = 'UNVALUED' OR l.base_currency_unit_cost IS NULL
          THEN l.remaining_quantity ELSE 0 END), 0) AS unvalued_qty,
        COALESCE(SUM(CASE WHEN l.base_currency_unit_cost IS NOT NULL
          THEN l.remaining_quantity * l.base_currency_unit_cost ELSE 0 END), 0)::text AS total_value
      FROM inventory_cost_layers l
      WHERE l.company_id = ${company.companyId}::uuid
        AND l.remaining_quantity > 0
        ${warehouseId ? Prisma.sql`AND l.warehouse_id = ${warehouseId}::uuid` : Prisma.empty}
      GROUP BY l.classification
      ORDER BY l.classification ASC
    `;

    return {
      data: rows.map((r) => ({
        classification: r.classification,
        valuedQuantity: Number(r.valued_qty),
        unvaluedQuantity: Number(r.unvalued_qty),
        totalValue: r.total_value ?? '0',
      })),
    };
  }

  async unvalued(company: CompanyContext) {
    const rows = await this.database.client.inventoryCostLayer.findMany({
      where: {
        companyId: company.companyId,
        remainingQuantity: { gt: 0 },
        valuationStatus: InventoryValuationStatus.UNVALUED,
      },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 200,
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        sku: { select: { id: true, code: true, name: true } },
        batch: { select: { id: true, batchNumber: true } },
      },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        warehouseId: r.warehouseId,
        skuId: r.skuId,
        batchId: r.batchId,
        classification: r.classification,
        remainingQuantity: r.remainingQuantity,
        sourceType: r.sourceType,
        receivedAt: r.receivedAt.toISOString(),
        warehouse: r.warehouse,
        sku: r.sku,
        batch: r.batch,
      })),
    };
  }
}
