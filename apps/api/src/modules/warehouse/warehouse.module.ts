import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { FinanceModule } from '../finance/finance.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { RbacModule } from '../rbac/rbac.module';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';
import { InventoryAdjustmentsController } from './inventory-adjustments.controller';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { InventoryController } from './inventory.controller';
import { InventoryCostLayersService } from './inventory-cost-layers.service';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryQueryService } from './inventory-query.service';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { InventoryReservationsController } from './inventory-reservations.controller';
import { InventoryReservationsService } from './inventory-reservations.service';
import { InventoryValuationController } from './inventory-valuation.controller';
import { InventoryValuationService } from './inventory-valuation.service';
import { WarehouseActivityService } from './warehouse-activity.service';
import { WarehouseDashboardController } from './warehouse-dashboard.controller';
import { WarehouseDashboardService } from './warehouse-dashboard.service';
import { WarehouseScannerController } from './warehouse-scanner.controller';
import { PutawaysController } from './putaways.controller';
import { PutawaysService } from './putaways.service';
import { StockClassificationController } from './stock-classification.controller';
import { StockClassificationService } from './stock-classification.service';
import { StockCountsController } from './stock-counts.controller';
import { StockCountsService } from './stock-counts.service';
import { StockIssuesController } from './stock-issues.controller';
import { StockIssuesService } from './stock-issues.service';
import {
  SupplierReturnExecutionsController,
  WarehouseSupplierReturnsController,
} from './supplier-return-executions.controller';
import { SupplierReturnExecutionsService } from './supplier-return-executions.service';
import { StockTransfersController } from './stock-transfers.controller';
import { StockTransfersService } from './stock-transfers.service';
import { WarehouseLocationsController } from './warehouse-locations.controller';
import { WarehouseLocationsService } from './warehouse-locations.service';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

/**
 * Warehouse domain module.
 * Phase 4.4: imports FinanceModule for payable recognition / return reduction
 * (Finance must NOT import Warehouse).
 */
@Module({
  imports: [
    AuditModule,
    CatalogModule,
    forwardRef(() => RbacModule),
    PurchasingModule,
    forwardRef(() => FinanceModule),
  ],
  controllers: [
    WarehousesController,
    WarehouseLocationsController,
    GoodsReceiptsController,
    BatchesController,
    PutawaysController,
    InventoryController,
    StockTransfersController,
    StockClassificationController,
    StockIssuesController,
    InventoryAdjustmentsController,
    StockCountsController,
    WarehouseSupplierReturnsController,
    SupplierReturnExecutionsController,
    InventoryReservationsController,
    InventoryValuationController,
    WarehouseScannerController,
    WarehouseDashboardController,
  ],
  providers: [
    WarehousesService,
    WarehouseLocationsService,
    GoodsReceiptsService,
    BatchesService,
    InventoryCostLayersService,
    InventoryLedgerService,
    InventoryQueryService,
    InventoryReconciliationService,
    InventoryReservationsService,
    InventoryValuationService,
    WarehouseDashboardService,
    WarehouseActivityService,
    PutawaysService,
    StockTransfersService,
    StockClassificationService,
    StockIssuesService,
    InventoryAdjustmentsService,
    StockCountsService,
    SupplierReturnExecutionsService,
  ],
  exports: [
    WarehousesService,
    WarehouseLocationsService,
    GoodsReceiptsService,
    BatchesService,
    InventoryCostLayersService,
    InventoryLedgerService,
    InventoryQueryService,
    InventoryReconciliationService,
    InventoryReservationsService,
    InventoryValuationService,
    WarehouseDashboardService,
    PutawaysService,
    StockTransfersService,
    StockClassificationService,
    StockIssuesService,
    InventoryAdjustmentsService,
    StockCountsService,
    SupplierReturnExecutionsService,
  ],
})
export class WarehouseModule {}
