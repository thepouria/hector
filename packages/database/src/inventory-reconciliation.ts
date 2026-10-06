/**
 * Shared InventoryBalance ↔ InventoryMovement reconciliation / rebuild helpers.
 * Ledger is canonical; Balance is a rebuildable projection (Phase 3.10).
 *
 * Zero-balance policy: keep rows with onHandQuantity = 0 (position identity / concurrency).
 */
import type { PrismaClient } from './generated/prisma/client';
import type { StockClassification } from './generated/prisma/enums';

export type InventoryPositionKey = {
  companyId: string;
  warehouseId: string;
  locationId: string;
  skuId: string;
  batchId: string;
  classification: StockClassification;
};

export type ReconcileStatus =
  | 'MATCH'
  | 'MISMATCH'
  | 'MISSING_BALANCE'
  | 'ORPHAN_BALANCE'
  | 'INVALID_NEGATIVE';

export type PositionReconcileResult = InventoryPositionKey & {
  ledgerQuantity: number;
  balanceQuantity: number | null;
  difference: number | null;
  status: ReconcileStatus;
  balanceId?: string;
};

export type CompanyReconcileSummary = {
  companyId: string | null;
  positionsChecked: number;
  matched: number;
  mismatched: number;
  missingBalances: number;
  orphanBalances: number;
  negativePositions: number;
  samples: PositionReconcileResult[];
};

type LedgerAggRow = InventoryPositionKey & { ledger_quantity: number };
type BalanceRow = InventoryPositionKey & {
  id: string;
  on_hand_quantity: number;
};

function positionKey(p: InventoryPositionKey): string {
  return [
    p.companyId,
    p.warehouseId,
    p.locationId,
    p.skuId,
    p.batchId,
    p.classification,
  ].join('|');
}

function classify(input: {
  ledgerQuantity: number;
  balanceQuantity: number | null;
}): ReconcileStatus {
  const { ledgerQuantity, balanceQuantity } = input;
  if (balanceQuantity === null) {
    if (ledgerQuantity < 0) return 'INVALID_NEGATIVE';
    return 'MISSING_BALANCE';
  }
  if (balanceQuantity < 0 || ledgerQuantity < 0) return 'INVALID_NEGATIVE';
  if (ledgerQuantity === 0 && balanceQuantity !== 0) {
    // Balance exists without ledger contribution (or ledger nets to zero) — orphan if no movements.
    // Handled by caller with movement presence; here treat quantity mismatch.
  }
  if (ledgerQuantity !== balanceQuantity) return 'MISMATCH';
  return 'MATCH';
}

export async function loadLedgerAggregates(
  prisma: PrismaClient,
  filter?: { companyId?: string },
): Promise<Map<string, LedgerAggRow>> {
  const rows = filter?.companyId
    ? await prisma.$queryRaw<LedgerAggRow[]>`
        SELECT company_id AS "companyId",
               warehouse_id AS "warehouseId",
               location_id AS "locationId",
               sku_id AS "skuId",
               batch_id AS "batchId",
               classification,
               COALESCE(SUM(quantity_delta), 0)::int AS ledger_quantity
        FROM inventory_movements
        WHERE company_id = ${filter.companyId}::uuid
        GROUP BY company_id, warehouse_id, location_id, sku_id, batch_id, classification`
    : await prisma.$queryRaw<LedgerAggRow[]>`
        SELECT company_id AS "companyId",
               warehouse_id AS "warehouseId",
               location_id AS "locationId",
               sku_id AS "skuId",
               batch_id AS "batchId",
               classification,
               COALESCE(SUM(quantity_delta), 0)::int AS ledger_quantity
        FROM inventory_movements
        GROUP BY company_id, warehouse_id, location_id, sku_id, batch_id, classification`;

  const map = new Map<string, LedgerAggRow>();
  for (const row of rows) {
    map.set(positionKey(row), row);
  }
  return map;
}

export async function loadBalances(
  prisma: PrismaClient,
  filter?: { companyId?: string },
): Promise<Map<string, BalanceRow>> {
  const rows = filter?.companyId
    ? await prisma.$queryRaw<BalanceRow[]>`
        SELECT id,
               company_id AS "companyId",
               warehouse_id AS "warehouseId",
               location_id AS "locationId",
               sku_id AS "skuId",
               batch_id AS "batchId",
               classification,
               on_hand_quantity
        FROM inventory_balances
        WHERE company_id = ${filter.companyId}::uuid`
    : await prisma.$queryRaw<BalanceRow[]>`
        SELECT id,
               company_id AS "companyId",
               warehouse_id AS "warehouseId",
               location_id AS "locationId",
               sku_id AS "skuId",
               batch_id AS "batchId",
               classification,
               on_hand_quantity
        FROM inventory_balances`;

  const map = new Map<string, BalanceRow>();
  for (const row of rows) {
    map.set(positionKey(row), row);
  }
  return map;
}

export async function reconcileInventory(
  prisma: PrismaClient,
  options?: { companyId?: string; sampleLimit?: number },
): Promise<CompanyReconcileSummary> {
  const sampleLimit = options?.sampleLimit ?? 50;
  const ledger = await loadLedgerAggregates(prisma, { companyId: options?.companyId });
  const balances = await loadBalances(prisma, { companyId: options?.companyId });

  const keys = new Set([...ledger.keys(), ...balances.keys()]);
  let matched = 0;
  let mismatched = 0;
  let missingBalances = 0;
  let orphanBalances = 0;
  let negativePositions = 0;
  const samples: PositionReconcileResult[] = [];

  for (const key of keys) {
    const l = ledger.get(key);
    const b = balances.get(key);
    const ledgerQuantity = l?.ledger_quantity ?? 0;
    const balanceQuantity = b ? b.on_hand_quantity : null;
    const base: InventoryPositionKey = l ?? b!;

    let status: ReconcileStatus;
    if (!l && b) {
      // Balance row without any ledger movements for this position.
      status = b.on_hand_quantity < 0 ? 'INVALID_NEGATIVE' : 'ORPHAN_BALANCE';
    } else if (l && !b) {
      status = ledgerQuantity < 0 ? 'INVALID_NEGATIVE' : 'MISSING_BALANCE';
    } else {
      status = classify({ ledgerQuantity, balanceQuantity });
      // Ledger nets to 0 with a balance row of 0 is MATCH (zero-balance keep policy).
      if (
        status === 'MATCH' &&
        ledgerQuantity === 0 &&
        balanceQuantity === 0 &&
        !l
      ) {
        status = 'ORPHAN_BALANCE';
      }
    }

    if (status === 'MATCH') matched += 1;
    else if (status === 'MISMATCH') mismatched += 1;
    else if (status === 'MISSING_BALANCE') missingBalances += 1;
    else if (status === 'ORPHAN_BALANCE') orphanBalances += 1;

    if (
      status === 'INVALID_NEGATIVE' ||
      (balanceQuantity !== null && balanceQuantity < 0) ||
      ledgerQuantity < 0
    ) {
      negativePositions += 1;
      if (status === 'MATCH' || status === 'MISMATCH') {
        // Negative overrides to INVALID_NEGATIVE for reporting clarity.
        status = 'INVALID_NEGATIVE';
      }
    }

    if (status !== 'MATCH' && samples.length < sampleLimit) {
      samples.push({
        ...base,
        ledgerQuantity,
        balanceQuantity,
        difference:
          balanceQuantity === null ? null : balanceQuantity - ledgerQuantity,
        status,
        balanceId: b?.id,
      });
    }
  }

  return {
    companyId: options?.companyId ?? null,
    positionsChecked: keys.size,
    matched,
    mismatched,
    missingBalances,
    orphanBalances,
    negativePositions,
    samples,
  };
}

export async function reconcilePosition(
  prisma: PrismaClient,
  position: InventoryPositionKey,
): Promise<PositionReconcileResult> {
  const [ledgerAgg, balance] = await Promise.all([
    prisma.inventoryMovement.aggregate({
      where: {
        companyId: position.companyId,
        warehouseId: position.warehouseId,
        locationId: position.locationId,
        skuId: position.skuId,
        batchId: position.batchId,
        classification: position.classification,
      },
      _sum: { quantityDelta: true },
      _count: { _all: true },
    }),
    prisma.inventoryBalance.findUnique({
      where: {
        companyId_warehouseId_locationId_skuId_batchId_classification: position,
      },
    }),
  ]);

  const ledgerQuantity = ledgerAgg._sum.quantityDelta ?? 0;
  const movementCount = ledgerAgg._count._all;
  const balanceQuantity = balance ? balance.onHandQuantity : null;

  let status: ReconcileStatus;
  if (movementCount === 0 && !balance) {
    status = 'MATCH';
  } else if (movementCount === 0 && balance) {
    status = balance.onHandQuantity < 0 ? 'INVALID_NEGATIVE' : 'ORPHAN_BALANCE';
  } else if (movementCount > 0 && !balance) {
    status = ledgerQuantity < 0 ? 'INVALID_NEGATIVE' : 'MISSING_BALANCE';
  } else {
    status = classify({ ledgerQuantity, balanceQuantity });
    if (
      (balanceQuantity !== null && balanceQuantity < 0) ||
      ledgerQuantity < 0
    ) {
      status = 'INVALID_NEGATIVE';
    }
  }

  return {
    ...position,
    ledgerQuantity,
    balanceQuantity,
    difference: balanceQuantity === null ? null : balanceQuantity - ledgerQuantity,
    status,
    balanceId: balance?.id,
  };
}

export type RebuildPlanRow = InventoryPositionKey & {
  expectedOnHand: number;
  currentOnHand: number | null;
  action: 'CREATE' | 'UPDATE' | 'DELETE_ORPHAN' | 'KEEP';
};

export type RebuildReport = {
  dryRun: boolean;
  companyId: string | null;
  positionsFromLedger: number;
  creates: number;
  updates: number;
  deletes: number;
  unchanged: number;
  plan: RebuildPlanRow[];
};

/**
 * Rebuild InventoryBalance from Ledger. Never mutates InventoryMovement.
 * Keeps zero-balance rows for positions that have movement history.
 * Deletes orphan balances (no ledger movements for that position).
 */
export async function rebuildInventoryBalances(
  prisma: PrismaClient,
  options?: { companyId?: string; dryRun?: boolean; planLimit?: number },
): Promise<RebuildReport> {
  const dryRun = options?.dryRun === true;
  const planLimit = options?.planLimit ?? 200;
  const ledger = await loadLedgerAggregates(prisma, { companyId: options?.companyId });
  const balances = await loadBalances(prisma, { companyId: options?.companyId });

  let creates = 0;
  let updates = 0;
  let deletes = 0;
  let unchanged = 0;
  const plan: RebuildPlanRow[] = [];

  for (const [key, l] of ledger) {
    const b = balances.get(key);
    const expected = l.ledger_quantity;
    if (!b) {
      creates += 1;
      if (plan.length < planLimit) {
        plan.push({
          companyId: l.companyId,
          warehouseId: l.warehouseId,
          locationId: l.locationId,
          skuId: l.skuId,
          batchId: l.batchId,
          classification: l.classification,
          expectedOnHand: expected,
          currentOnHand: null,
          action: 'CREATE',
        });
      }
      if (!dryRun) {
        await prisma.inventoryBalance.create({
          data: {
            companyId: l.companyId,
            warehouseId: l.warehouseId,
            locationId: l.locationId,
            skuId: l.skuId,
            batchId: l.batchId,
            classification: l.classification,
            onHandQuantity: expected,
          },
        });
      }
    } else if (b.on_hand_quantity !== expected) {
      updates += 1;
      if (plan.length < planLimit) {
        plan.push({
          companyId: l.companyId,
          warehouseId: l.warehouseId,
          locationId: l.locationId,
          skuId: l.skuId,
          batchId: l.batchId,
          classification: l.classification,
          expectedOnHand: expected,
          currentOnHand: b.on_hand_quantity,
          action: 'UPDATE',
        });
      }
      if (!dryRun) {
        await prisma.inventoryBalance.update({
          where: { id: b.id },
          data: { onHandQuantity: expected },
        });
      }
    } else {
      unchanged += 1;
      if (plan.length < planLimit) {
        plan.push({
          companyId: l.companyId,
          warehouseId: l.warehouseId,
          locationId: l.locationId,
          skuId: l.skuId,
          batchId: l.batchId,
          classification: l.classification,
          expectedOnHand: expected,
          currentOnHand: b.on_hand_quantity,
          action: 'KEEP',
        });
      }
    }
  }

  for (const [key, b] of balances) {
    if (ledger.has(key)) continue;
    deletes += 1;
    if (plan.length < planLimit) {
      plan.push({
        companyId: b.companyId,
        warehouseId: b.warehouseId,
        locationId: b.locationId,
        skuId: b.skuId,
        batchId: b.batchId,
        classification: b.classification,
        expectedOnHand: 0,
        currentOnHand: b.on_hand_quantity,
        action: 'DELETE_ORPHAN',
      });
    }
    if (!dryRun) {
      await prisma.inventoryBalance.delete({ where: { id: b.id } });
    }
  }

  return {
    dryRun,
    companyId: options?.companyId ?? null,
    positionsFromLedger: ledger.size,
    creates,
    updates,
    deletes,
    unchanged,
    plan,
  };
}
