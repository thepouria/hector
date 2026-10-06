import type { Prisma } from '@hector/database';
import type { DatabaseService } from '../../src/infrastructure/database/database.service';

/**
 * Delete inventory movements after removing FIFO layer consumptions (Phase 3.15+).
 *
 * Note: e2e cleanup intentionally removes ledger rows for fixtures. That can leave
 * cost-layer remaining / balance drift in the shared DB afterward — production
 * paths never delete posted movements. Re-seed / clean bootstrap before
 * `pnpm inventory:reconcile` gates.
 */
export async function deleteInventoryMovements(
  database: DatabaseService,
  where: Prisma.InventoryMovementWhereInput,
): Promise<void> {
  const movements = await database.client.inventoryMovement.findMany({
    where,
    select: { id: true },
  });
  const ids = movements.map((m) => m.id);
  if (ids.length === 0) return;
  await database.client.inventoryLayerConsumption.deleteMany({
    where: { inventoryMovementId: { in: ids } },
  });
  await database.client.inventoryMovement.deleteMany({
    where: { id: { in: ids } },
  });
}
