import { Module, forwardRef } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AuditModule } from '../audit/audit.module';
import { RbacModule } from '../rbac/rbac.module';
import { PurchaseReceivingContract } from './contracts/purchase-receiving.contract';
import { PurchaseReceivingService } from './contracts/purchase-receiving.service';
import { PurchaseDiscrepanciesService } from './purchase-discrepancies.service';
import { PurchaseOrderCorrectionsController } from './purchase-order-corrections.controller';
import { PurchaseOrderCorrectionsService } from './purchase-order-corrections.service';
import { PurchaseOrderCostsController } from './purchase-order-costs.controller';
import { PurchaseOrderCostsService } from './purchase-order-costs.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseReturnsController } from './purchase-returns.controller';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseDashboardService } from './purchase-dashboard.service';
import { PurchasingController } from './purchasing.controller';
import { PurchasingSummaryService } from './purchasing-summary.service';
import { SupplierContactsService } from './supplier-contacts.service';
import { SupplierNotesService } from './supplier-notes.service';
import { SupplierOffersController } from './supplier-offers.controller';
import { SupplierOffersService } from './supplier-offers.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/**
 * Purchasing domain module.
 * Phase 2.2–2.11: Supplier → PO → Lifecycle → Receiving Contract → Returns/Corrections
 * Phase 2.12: Purchasing API consolidation (HTTP boundary; domain rules stay in services)
 * Phase 2.14: Purchase Dashboard read model
 */
@Module({
  imports: [AuditModule, CatalogModule, forwardRef(() => RbacModule)],
  controllers: [
    PurchasingController,
    SuppliersController,
    SupplierOffersController,
    PurchaseOrdersController,
    PurchaseOrderCostsController,
    PurchaseOrderCorrectionsController,
    PurchaseReturnsController,
  ],
  providers: [
    PurchasingSummaryService,
    PurchaseDashboardService,
    SuppliersService,
    SupplierContactsService,
    SupplierNotesService,
    SupplierOffersService,
    PurchaseOrdersService,
    PurchaseOrderCostsService,
    PurchaseOrderCorrectionsService,
    PurchaseDiscrepanciesService,
    PurchaseReturnsService,
    PurchaseReceivingService,
    { provide: PurchaseReceivingContract, useExisting: PurchaseReceivingService },
  ],
  exports: [
    PurchasingSummaryService,
    PurchaseDashboardService,
    SuppliersService,
    SupplierOffersService,
    PurchaseOrdersService,
    PurchaseOrderCostsService,
    PurchaseOrderCorrectionsService,
    PurchaseDiscrepanciesService,
    PurchaseReturnsService,
    PurchaseReceivingContract,
    PurchaseReceivingService,
  ],
})
export class PurchasingModule {}
