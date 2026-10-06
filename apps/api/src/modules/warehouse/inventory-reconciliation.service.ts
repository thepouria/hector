import { Injectable, Logger } from '@nestjs/common';
import {
  rebuildInventoryBalances,
  reconcileInventory,
  reconcilePosition,
  type CompanyReconcileSummary,
  type InventoryPositionKey,
  type PositionReconcileResult,
  type RebuildReport,
} from '@hector/database';
import { DatabaseService } from '../../infrastructure/database/database.service';

/**
 * Internal reconciliation / rebuild of InventoryBalance from Ledger (Phase 3.10).
 * Not exposed as a normal business mutation API.
 *
 * Operational Balance mutations remain InventoryLedgerService only.
 * Rebuild is administrative infrastructure (CLI + tests).
 */
@Injectable()
export class InventoryReconciliationService {
  private readonly logger = new Logger(InventoryReconciliationService.name);

  constructor(private readonly database: DatabaseService) {}

  async reconcileCompany(companyId?: string): Promise<CompanyReconcileSummary> {
    return reconcileInventory(this.database.client, { companyId });
  }

  async reconcilePosition(
    position: InventoryPositionKey,
  ): Promise<PositionReconcileResult> {
    return reconcilePosition(this.database.client, position);
  }

  async rebuildBalances(options?: {
    companyId?: string;
    dryRun?: boolean;
  }): Promise<RebuildReport> {
    const dryRun = options?.dryRun === true;
    this.logger.log(
      `Inventory balance rebuild ${dryRun ? 'DRY-RUN' : 'START'} company=${options?.companyId ?? 'ALL'}`,
    );
    const report = await rebuildInventoryBalances(this.database.client, {
      companyId: options?.companyId,
      dryRun,
    });
    this.logger.log(
      `Inventory balance rebuild ${dryRun ? 'DRY-RUN DONE' : 'COMPLETED'} ` +
        `ledgerPositions=${report.positionsFromLedger} creates=${report.creates} ` +
        `updates=${report.updates} deletes=${report.deletes} unchanged=${report.unchanged}`,
    );
    return report;
  }
}
