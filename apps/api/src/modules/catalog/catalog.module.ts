import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AttributeOptionsController } from './attribute-options.controller';
import { AttributesController } from './attributes.controller';
import { AttributesService } from './attributes.service';
import { BarcodesController } from './barcodes.controller';
import { CategoryAttributesService } from './category-attributes.service';
import { EntityAttributesController } from './entity-attributes.controller';
import { EntityAttributesService } from './entity-attributes.service';
import { BarcodesService } from './barcodes.service';
import { CatalogBulkController } from './catalog-bulk.controller';
import { CatalogBulkService } from './catalog-bulk.service';
import { CatalogPlatformController } from './catalog-platform.controller';
import { CatalogQueryService } from './catalog-query.service';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ProductSkusController } from './product-skus.controller';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { SkuBarcodesController } from './sku-barcodes.controller';
import { SkusController } from './skus.controller';
import { SkusService } from './skus.service';
import { VariantsController } from './variants.controller';
import { VariantsService } from './variants.service';

@Module({
  imports: [AuditModule],
  controllers: [
    CatalogPlatformController,
    CatalogBulkController,
    AttributesController,
    AttributeOptionsController,
    EntityAttributesController,
    BrandsController,
    CategoriesController,
    ProductsController,
    ProductSkusController,
    SkusController,
    SkuBarcodesController,
    VariantsController,
    BarcodesController,
  ],
  providers: [
    CatalogQueryService,
    CatalogBulkService,
    AttributesService,
    CategoryAttributesService,
    EntityAttributesService,
    BrandsService,
    CategoriesService,
    ProductsService,
    SkusService,
    VariantsService,
    BarcodesService,
  ],
  exports: [
    CatalogQueryService,
    CatalogBulkService,
    AttributesService,
    CategoryAttributesService,
    EntityAttributesService,
    BrandsService,
    CategoriesService,
    ProductsService,
    SkusService,
    VariantsService,
    BarcodesService,
  ],
})
export class CatalogModule {}
