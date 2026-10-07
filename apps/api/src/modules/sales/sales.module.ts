import { Module, forwardRef } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { FinanceModule } from '../finance/finance.module';
import { PartyModule } from '../party/party.module';
import { RbacModule } from '../rbac/rbac.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { SalesChannelsController } from './sales-channels.controller';
import { SalesChannelsService } from './sales-channels.service';
import { SalesDashboardController } from './sales-dashboard.controller';
import { SalesDashboardService } from './sales-dashboard.service';
import { SalesFulfillmentsController } from './sales-fulfillments.controller';
import { SalesFulfillmentsService } from './sales-fulfillments.service';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';
import { SalesReservationsService } from './sales-reservations.service';
import { SalesReturnsController } from './sales-returns.controller';
import { SalesReturnsService } from './sales-returns.service';

/**
 * Sales domain module.
 * Phase 5.1: Channel + Customer Master.
 * Phase 5.2: Sales Orders + Returns (commercial lifecycle).
 * Phase 5.3: Reservation + Fulfillment + Finance AR integration.
 * Phase 5.4: Dashboard + detail enrichment + integrity.
 * Phase 5.5.2: Customer ↔ Party identity linking.
 */
@Module({
  imports: [
    AuditModule,
    CatalogModule,
    PartyModule,
    forwardRef(() => RbacModule),
    forwardRef(() => WarehouseModule),
    forwardRef(() => FinanceModule),
  ],
  controllers: [
    SalesDashboardController,
    SalesChannelsController,
    CustomersController,
    SalesOrdersController,
    SalesReturnsController,
    SalesFulfillmentsController,
  ],
  providers: [
    SalesDashboardService,
    SalesChannelsService,
    CustomersService,
    SalesOrdersService,
    SalesReturnsService,
    SalesReservationsService,
    SalesFulfillmentsService,
  ],
  exports: [
    SalesDashboardService,
    SalesChannelsService,
    CustomersService,
    SalesOrdersService,
    SalesReturnsService,
    SalesReservationsService,
    SalesFulfillmentsService,
  ],
})
export class SalesModule {}
