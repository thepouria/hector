import {
  CurrencyCode,
  InventoryCostComponentSourceType,
  InventoryValuationStatus,
  Prisma,
  PurchaseCostType,
} from '@hector/database';

type Tx = Prisma.TransactionClient;

export type LayerCostIncrement = {
  layerId: string;
  /** Absolute amount in cost currency to add to this layer's acquisition value. */
  allocatedAmount: Prisma.Decimal;
  currency: CurrencyCode;
  /** Amount in company base currency to add to (unitCost * originalQty) basis. */
  baseAmount: Prisma.Decimal;
  costType: PurchaseCostType;
  sourceId: string;
  appliedFxRate?: Prisma.Decimal | null;
};

/**
 * Warehouse-owned helper: apply capitalizable purchase-cost amounts onto FIFO layers.
 * NEVER changes quantity. Updates unit cost snapshots + InventoryCostComponent provenance.
 *
 * Finance/Purchasing must call this helper rather than mutating layers ad hoc (FIN-BND).
 */
export async function applyCapitalizableCostToLayersInTx(
  tx: Tx,
  companyId: string,
  increments: LayerCostIncrement[],
  options?: { clearUnallocatedFlag?: boolean },
): Promise<void> {
  for (const inc of increments) {
    if (inc.allocatedAmount.lte(0) || inc.baseAmount.lte(0)) {
      throw new Error('Capitalizable layer increment must be positive.');
    }

    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        original_quantity: number;
        remaining_quantity: number;
        base_currency_unit_cost: Prisma.Decimal | null;
        original_unit_amount: Prisma.Decimal | null;
        original_currency: CurrencyCode | null;
        has_unallocated_purchase_costs: boolean;
        valuation_status: InventoryValuationStatus;
      }>
    >(Prisma.sql`
      SELECT id, original_quantity, remaining_quantity, base_currency_unit_cost,
             original_unit_amount, original_currency, has_unallocated_purchase_costs,
             valuation_status
      FROM inventory_cost_layers
      WHERE id = ${inc.layerId}::uuid AND company_id = ${companyId}::uuid
      FOR UPDATE
    `);
    const layer = locked[0];
    if (!layer) {
      throw new Error(`Inventory cost layer ${inc.layerId} not found.`);
    }
    if (layer.original_quantity <= 0) {
      throw new Error('Cannot capitalize onto a zero-quantity layer.');
    }

    const qty = new Prisma.Decimal(layer.original_quantity);
    const prevBaseUnit = layer.base_currency_unit_cost ?? new Prisma.Decimal(0);
    const prevBaseTotal = prevBaseUnit.mul(qty);
    const nextBaseTotal = prevBaseTotal.add(inc.baseAmount);
    const nextBaseUnit = nextBaseTotal.div(qty);

    const sameCurrency =
      layer.original_currency == null || layer.original_currency === inc.currency;
    let nextOriginalUnit = layer.original_unit_amount;
    let nextOriginalCurrency = layer.original_currency;
    if (sameCurrency) {
      const prevOrigUnit = layer.original_unit_amount ?? new Prisma.Decimal(0);
      const prevOrigTotal = prevOrigUnit.mul(qty);
      const nextOrigTotal = prevOrigTotal.add(inc.allocatedAmount);
      nextOriginalUnit = nextOrigTotal.div(qty);
      nextOriginalCurrency = inc.currency;
    }

    const clearFlag = options?.clearUnallocatedFlag === true;
    await tx.inventoryCostLayer.update({
      where: { id: layer.id },
      data: {
        baseCurrencyUnitCost: nextBaseUnit,
        originalUnitAmount: nextOriginalUnit,
        originalCurrency: nextOriginalCurrency,
        valuationStatus: InventoryValuationStatus.VALUED,
        ...(clearFlag ? { hasUnallocatedPurchaseCosts: false } : {}),
      },
    });

    await tx.inventoryCostComponent.create({
      data: {
        companyId,
        layerId: layer.id,
        sourceType: InventoryCostComponentSourceType.PURCHASE_ORDER_COST,
        sourceId: inc.sourceId,
        costType: inc.costType,
        allocatedAmount: inc.allocatedAmount,
        currency: inc.currency,
        baseAmount: inc.baseAmount,
        appliedFxRate: inc.appliedFxRate ?? null,
      },
    });
  }
}

/**
 * After all capitalizable costs for a PO are allocated, clear the unallocated flag
 * on layers still marked hasUnallocatedPurchaseCosts for that PO.
 */
export async function clearUnallocatedPurchaseCostFlagsForPoInTx(
  tx: Tx,
  companyId: string,
  purchaseOrderId: string,
): Promise<void> {
  await tx.inventoryCostLayer.updateMany({
    where: {
      companyId,
      purchaseOrderId,
      hasUnallocatedPurchaseCosts: true,
    },
    data: {
      hasUnallocatedPurchaseCosts: false,
      valuationStatus: InventoryValuationStatus.VALUED,
    },
  });
}
