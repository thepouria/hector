import type { DomainEvent } from './domain-event';
import { DOMAIN_EVENTS } from './domain-events.registry';

export type CompanyUpdatedPayload = {
  companyId: string;
  changedFields: string[];
};

export type MemberCreatedPayload = {
  memberId: string;
  userId: string;
  roleIds: string[];
};

export type MemberReactivatedPayload = {
  memberId: string;
  userId: string;
  roleIds: string[];
};

export type MemberStatusChangedPayload = {
  memberId: string;
  userId: string;
  previousStatus: string;
  newStatus: string;
};

export type MemberRemovedPayload = {
  memberId: string;
  userId: string;
};

export type MemberRolesChangedPayload = {
  memberId: string;
  previousRoleIds: string[];
  newRoleIds: string[];
};

export type RoleCreatedPayload = {
  roleId: string;
  key: string;
};

export type RoleUpdatedPayload = {
  roleId: string;
  changedFields: string[];
};

export type RolePermissionsChangedPayload = {
  roleId: string;
  previousPermissionKeys: string[];
  newPermissionKeys: string[];
};

export type RoleDeletedPayload = {
  roleId: string;
  key: string;
};

export type CompanyUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.COMPANY_UPDATED,
  CompanyUpdatedPayload
>;
export type MemberCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.MEMBER_CREATED,
  MemberCreatedPayload
>;
export type MemberReactivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.MEMBER_REACTIVATED,
  MemberReactivatedPayload
>;
export type MemberStatusChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.MEMBER_STATUS_CHANGED,
  MemberStatusChangedPayload
>;
export type MemberRemovedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.MEMBER_REMOVED,
  MemberRemovedPayload
>;
export type MemberRolesChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.MEMBER_ROLES_CHANGED,
  MemberRolesChangedPayload
>;
export type RoleCreatedEvent = DomainEvent<typeof DOMAIN_EVENTS.ROLE_CREATED, RoleCreatedPayload>;
export type RoleUpdatedEvent = DomainEvent<typeof DOMAIN_EVENTS.ROLE_UPDATED, RoleUpdatedPayload>;
export type RolePermissionsChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.ROLE_PERMISSIONS_CHANGED,
  RolePermissionsChangedPayload
>;
export type RoleDeletedEvent = DomainEvent<typeof DOMAIN_EVENTS.ROLE_DELETED, RoleDeletedPayload>;

export type CatalogProductCreatedPayload = {
  companyId: string;
  productId: string;
};

export type CatalogProductUpdatedPayload = {
  companyId: string;
  productId: string;
  changedFields: string[];
};

export type CatalogProductArchivedPayload = {
  companyId: string;
  productId: string;
};

export type CatalogProductDeactivatedPayload = {
  companyId: string;
  productId: string;
};

export type CatalogProductActivatedPayload = {
  companyId: string;
  productId: string;
};

export type CatalogSkuCreatedPayload = {
  companyId: string;
  productId: string;
  skuId: string;
};

export type CatalogSkuUpdatedPayload = {
  companyId: string;
  productId: string;
  skuId: string;
  changedFields: string[];
};

export type CatalogSkuArchivedPayload = {
  companyId: string;
  productId: string;
  skuId: string;
};

export type CatalogSkuDeactivatedPayload = {
  companyId: string;
  productId: string;
  skuId: string;
};

export type CatalogSkuActivatedPayload = {
  companyId: string;
  productId: string;
  skuId: string;
};

export type CatalogVariantOptionCreatedPayload = {
  companyId: string;
  productId: string;
  optionId: string;
};

export type CatalogVariantOptionUpdatedPayload = {
  companyId: string;
  productId: string;
  optionId: string;
  changedFields: string[];
};

export type CatalogVariantValueCreatedPayload = {
  companyId: string;
  productId: string;
  optionId: string;
  valueId: string;
};

export type CatalogVariantValueUpdatedPayload = {
  companyId: string;
  productId: string;
  optionId: string;
  valueId: string;
  changedFields: string[];
};

export type CatalogVariantValueDeactivatedPayload = {
  companyId: string;
  productId: string;
  optionId: string;
  valueId: string;
};

export type CatalogVariantValueActivatedPayload = {
  companyId: string;
  productId: string;
  optionId: string;
  valueId: string;
};

export type CatalogBarcodeAssignedPayload = {
  companyId: string;
  skuId: string;
  barcodeId: string;
};

export type CatalogBarcodeCreatedPayload = {
  companyId: string;
  productId: string;
  skuId: string;
  barcodeId: string;
};

export type CatalogBarcodeUpdatedPayload = {
  companyId: string;
  skuId: string;
  barcodeId: string;
  changedFields: string[];
};

export type CatalogBarcodePrimaryChangedPayload = {
  companyId: string;
  productId: string;
  skuId: string;
  barcodeId: string;
};

export type CatalogBarcodeArchivedPayload = {
  companyId: string;
  productId: string;
  skuId: string;
  barcodeId: string;
};

export type CatalogBrandCreatedPayload = {
  companyId: string;
  brandId: string;
};

export type CatalogBrandUpdatedPayload = {
  companyId: string;
  brandId: string;
  changedFields: string[];
};

export type CatalogBrandArchivedPayload = {
  companyId: string;
  brandId: string;
};

export type CatalogBrandActivatedPayload = {
  companyId: string;
  brandId: string;
};

export type CatalogCategoryCreatedPayload = {
  companyId: string;
  categoryId: string;
};

export type CatalogCategoryUpdatedPayload = {
  companyId: string;
  categoryId: string;
  changedFields: string[];
};

export type CatalogCategoryMovedPayload = {
  companyId: string;
  categoryId: string;
  oldParentId: string | null;
  newParentId: string | null;
};

export type CatalogCategoryArchivedPayload = {
  companyId: string;
  categoryId: string;
};

export type CatalogCategoryActivatedPayload = {
  companyId: string;
  categoryId: string;
};

export type CatalogProductCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_PRODUCT_CREATED,
  CatalogProductCreatedPayload
>;
export type CatalogProductUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_PRODUCT_UPDATED,
  CatalogProductUpdatedPayload
>;
export type CatalogProductArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_PRODUCT_ARCHIVED,
  CatalogProductArchivedPayload
>;
export type CatalogProductDeactivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_PRODUCT_DEACTIVATED,
  CatalogProductDeactivatedPayload
>;
export type CatalogProductActivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_PRODUCT_ACTIVATED,
  CatalogProductActivatedPayload
>;
export type CatalogSkuCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_SKU_CREATED,
  CatalogSkuCreatedPayload
>;
export type CatalogSkuUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_SKU_UPDATED,
  CatalogSkuUpdatedPayload
>;
export type CatalogSkuArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_SKU_ARCHIVED,
  CatalogSkuArchivedPayload
>;
export type CatalogSkuDeactivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_SKU_DEACTIVATED,
  CatalogSkuDeactivatedPayload
>;
export type CatalogSkuActivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_SKU_ACTIVATED,
  CatalogSkuActivatedPayload
>;
export type CatalogVariantOptionCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_VARIANT_OPTION_CREATED,
  CatalogVariantOptionCreatedPayload
>;
export type CatalogVariantOptionUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_VARIANT_OPTION_UPDATED,
  CatalogVariantOptionUpdatedPayload
>;
export type CatalogVariantValueCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_VARIANT_VALUE_CREATED,
  CatalogVariantValueCreatedPayload
>;
export type CatalogVariantValueUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_VARIANT_VALUE_UPDATED,
  CatalogVariantValueUpdatedPayload
>;
export type CatalogVariantValueDeactivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_VARIANT_VALUE_DEACTIVATED,
  CatalogVariantValueDeactivatedPayload
>;
export type CatalogVariantValueActivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_VARIANT_VALUE_ACTIVATED,
  CatalogVariantValueActivatedPayload
>;
export type CatalogBarcodeAssignedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BARCODE_ASSIGNED,
  CatalogBarcodeAssignedPayload
>;
export type CatalogBarcodeCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BARCODE_CREATED,
  CatalogBarcodeCreatedPayload
>;
export type CatalogBarcodeInternalGeneratedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BARCODE_INTERNAL_GENERATED,
  CatalogBarcodeCreatedPayload
>;
export type CatalogBarcodePrimaryChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BARCODE_PRIMARY_CHANGED,
  CatalogBarcodePrimaryChangedPayload
>;
export type CatalogBarcodeArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BARCODE_ARCHIVED,
  CatalogBarcodeArchivedPayload
>;
export type CatalogBarcodeUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BARCODE_UPDATED,
  CatalogBarcodeUpdatedPayload
>;
export type CatalogBrandCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BRAND_CREATED,
  CatalogBrandCreatedPayload
>;
export type CatalogBrandUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BRAND_UPDATED,
  CatalogBrandUpdatedPayload
>;
export type CatalogBrandArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BRAND_ARCHIVED,
  CatalogBrandArchivedPayload
>;
export type CatalogBrandActivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BRAND_ACTIVATED,
  CatalogBrandActivatedPayload
>;
export type CatalogCategoryCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_CATEGORY_CREATED,
  CatalogCategoryCreatedPayload
>;
export type CatalogCategoryUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_CATEGORY_UPDATED,
  CatalogCategoryUpdatedPayload
>;
export type CatalogCategoryMovedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_CATEGORY_MOVED,
  CatalogCategoryMovedPayload
>;
export type CatalogCategoryArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_CATEGORY_ARCHIVED,
  CatalogCategoryArchivedPayload
>;
export type CatalogCategoryActivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_CATEGORY_ACTIVATED,
  CatalogCategoryActivatedPayload
>;

export type CatalogAttributeCreatedPayload = {
  companyId: string;
  attributeId: string;
};

export type CatalogAttributeUpdatedPayload = {
  companyId: string;
  attributeId: string;
};

export type CatalogAttributeArchivedPayload = {
  companyId: string;
  attributeId: string;
};

export type CatalogAttributeOptionPayload = {
  companyId: string;
  attributeId: string;
  optionId: string;
};

export type CatalogCategoryAttributesUpdatedPayload = {
  companyId: string;
  categoryId: string;
};

export type CatalogProductAttributesUpdatedPayload = {
  companyId: string;
  productId: string;
};

export type CatalogSkuAttributesUpdatedPayload = {
  companyId: string;
  skuId: string;
};

export type CatalogBulkOperationCompletedPayload = {
  companyId: string;
  operationId: string;
  type: string;
  matched: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export type CatalogAttributeCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_ATTRIBUTE_CREATED,
  CatalogAttributeCreatedPayload
>;
export type CatalogAttributeUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_ATTRIBUTE_UPDATED,
  CatalogAttributeUpdatedPayload
>;
export type CatalogAttributeArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_ATTRIBUTE_ARCHIVED,
  CatalogAttributeArchivedPayload
>;
export type CatalogAttributeOptionCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_ATTRIBUTE_OPTION_CREATED,
  CatalogAttributeOptionPayload
>;
export type CatalogAttributeOptionUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_ATTRIBUTE_OPTION_UPDATED,
  CatalogAttributeOptionPayload
>;
export type CatalogAttributeOptionDeactivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_ATTRIBUTE_OPTION_DEACTIVATED,
  CatalogAttributeOptionPayload
>;
export type CatalogAttributeOptionActivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_ATTRIBUTE_OPTION_ACTIVATED,
  CatalogAttributeOptionPayload
>;
export type CatalogCategoryAttributesUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_CATEGORY_ATTRIBUTES_UPDATED,
  CatalogCategoryAttributesUpdatedPayload
>;
export type CatalogProductAttributesUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_PRODUCT_ATTRIBUTES_UPDATED,
  CatalogProductAttributesUpdatedPayload
>;
export type CatalogSkuAttributesUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_SKU_ATTRIBUTES_UPDATED,
  CatalogSkuAttributesUpdatedPayload
>;
export type CatalogBulkOperationCompletedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.CATALOG_BULK_OPERATION_COMPLETED,
  CatalogBulkOperationCompletedPayload
>;

export type PurchasingSupplierCreatedPayload = {
  companyId: string;
  supplierId: string;
};

export type PurchasingSupplierUpdatedPayload = {
  companyId: string;
  supplierId: string;
  changedFields: string[];
};

export type PurchasingSupplierStatusChangedPayload = {
  companyId: string;
  supplierId: string;
  previousStatus: string;
  newStatus: string;
};

export type PurchasingSupplierArchivedPayload = {
  companyId: string;
  supplierId: string;
};

export type PurchasingSupplierContactPayload = {
  companyId: string;
  supplierId: string;
  contactId: string;
};

export type PurchasingSupplierPrimaryContactChangedPayload = {
  companyId: string;
  supplierId: string;
  contactId: string;
  previousContactId: string | null;
};

export type PurchasingSupplierNoteCreatedPayload = {
  companyId: string;
  supplierId: string;
  noteId: string;
};

export type PurchasingSupplierCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_CREATED,
  PurchasingSupplierCreatedPayload
>;
export type PurchasingSupplierUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_UPDATED,
  PurchasingSupplierUpdatedPayload
>;
export type PurchasingSupplierStatusChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_STATUS_CHANGED,
  PurchasingSupplierStatusChangedPayload
>;
export type PurchasingSupplierArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_ARCHIVED,
  PurchasingSupplierArchivedPayload
>;
export type PurchasingSupplierContactCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_CONTACT_CREATED,
  PurchasingSupplierContactPayload
>;
export type PurchasingSupplierContactUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_CONTACT_UPDATED,
  PurchasingSupplierContactPayload
>;
export type PurchasingSupplierPrimaryContactChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_PRIMARY_CONTACT_CHANGED,
  PurchasingSupplierPrimaryContactChangedPayload
>;
export type PurchasingSupplierContactArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_CONTACT_ARCHIVED,
  PurchasingSupplierContactPayload
>;
export type PurchasingSupplierNoteCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_NOTE_CREATED,
  PurchasingSupplierNoteCreatedPayload
>;

export type PurchasingSupplierOfferCreatedPayload = {
  companyId: string;
  supplierOfferId: string;
  supplierId: string;
  skuId: string;
  currency: string;
  quotedAt: string;
};

export type PurchasingSupplierOfferUpdatedPayload = {
  companyId: string;
  supplierOfferId: string;
  supplierId: string;
  skuId: string;
  changedFields: string[];
};

export type PurchasingSupplierOfferArchivedPayload = {
  companyId: string;
  supplierOfferId: string;
  supplierId: string;
  skuId: string;
};

export type PurchasingSupplierOfferCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_CREATED,
  PurchasingSupplierOfferCreatedPayload
>;
export type PurchasingSupplierOfferUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_UPDATED,
  PurchasingSupplierOfferUpdatedPayload
>;
export type PurchasingSupplierOfferArchivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_SUPPLIER_OFFER_ARCHIVED,
  PurchasingSupplierOfferArchivedPayload
>;

export type PurchasingPurchaseOrderBasePayload = {
  companyId: string;
  purchaseOrderId: string;
  number: string;
  supplierId: string;
  status: string;
  currency: string;
};

export type PurchasingPurchaseOrderCreatedPayload = PurchasingPurchaseOrderBasePayload & {
  total: string;
  itemCount: number;
};

export type PurchasingPurchaseOrderUpdatedPayload = PurchasingPurchaseOrderBasePayload & {
  changedFields: string[];
};

export type PurchasingPurchaseOrderItemPayload = PurchasingPurchaseOrderBasePayload & {
  purchaseOrderItemId: string;
  skuId: string;
  quantity: number;
  total: string;
};

export type PurchasingPurchaseOrderTransitionPayload = PurchasingPurchaseOrderBasePayload & {
  previousStatus: string;
  purchaseType: string | null;
  total: string;
  itemCount: number;
  version: number;
  approvedAt?: string | null;
  orderedAt?: string | null;
  cancelledAt?: string | null;
  reason?: string | null;
};

export type PurchasingPurchaseOrderCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CREATED,
  PurchasingPurchaseOrderCreatedPayload
>;
export type PurchasingPurchaseOrderUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_UPDATED,
  PurchasingPurchaseOrderUpdatedPayload
>;
export type PurchasingPurchaseOrderItemAddedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_ADDED,
  PurchasingPurchaseOrderItemPayload
>;
export type PurchasingPurchaseOrderItemUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_UPDATED,
  PurchasingPurchaseOrderItemPayload
>;
export type PurchasingPurchaseOrderItemRemovedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ITEM_REMOVED,
  PurchasingPurchaseOrderItemPayload
>;
export type PurchasingPurchaseOrderApprovedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_APPROVED,
  PurchasingPurchaseOrderTransitionPayload
>;
export type PurchasingPurchaseOrderOrderedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_ORDERED,
  PurchasingPurchaseOrderTransitionPayload
>;
export type PurchasingPurchaseOrderCancelledEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CANCELLED,
  PurchasingPurchaseOrderTransitionPayload
>;

export type PurchasingPurchaseCostPayload = {
  companyId: string;
  purchaseOrderId: string;
  purchaseCostId: string;
  type: string;
  currency: string;
  amount: string;
  status: string;
};

export type PurchasingPurchaseCostAddedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_ADDED,
  PurchasingPurchaseCostPayload
>;
export type PurchasingPurchaseCostUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_UPDATED,
  PurchasingPurchaseCostPayload
>;
export type PurchasingPurchaseCostVoidedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_VOIDED,
  PurchasingPurchaseCostPayload & { voidReason: string }
>;
export type PurchasingPurchaseCostRemovedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_COST_REMOVED,
  PurchasingPurchaseCostPayload
>;

export type PurchasingPurchaseOrderCorrectedPayload = {
  companyId: string;
  purchaseOrderId: string;
  correctionId: string;
  type: string;
  purchaseOrderItemId: string | null;
};

export type PurchasingPurchaseDueDateChangedPayload = {
  companyId: string;
  purchaseOrderId: string;
  correctionId: string;
  previousDueDate: string | null;
  newDueDate: string | null;
};

export type PurchasingPurchaseFxTermsChangedPayload = {
  companyId: string;
  purchaseOrderId: string;
  correctionId: string;
  previousObligationAmount: string | null;
  newObligationAmount: string | null;
  obligationCurrency: string | null;
  previousReferenceFxRate: string | null;
  newReferenceFxRate: string | null;
};

export type PurchasingPurchaseDiscrepancyRecordedPayload = {
  companyId: string;
  purchaseOrderId: string;
  discrepancyId: string;
  type: string;
  purchaseOrderItemId: string;
  quantity: number;
};

export type PurchasingPurchaseOrderShortClosedPayload = {
  companyId: string;
  purchaseOrderId: string;
  purchaseOrderItemId: string;
  discrepancyId: string;
  quantity: number;
};

export type PurchasingPurchaseReturnPayload = {
  companyId: string;
  purchaseReturnId: string;
  purchaseOrderId: string;
  supplierId: string;
  status: string;
  approvedAt?: string | null;
};

export type PurchasingPurchaseOrderCorrectedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_CORRECTED,
  PurchasingPurchaseOrderCorrectedPayload
>;
export type PurchasingPurchaseDueDateChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_DUE_DATE_CHANGED,
  PurchasingPurchaseDueDateChangedPayload
>;
export type PurchasingPurchaseFxTermsChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_FX_TERMS_CHANGED,
  PurchasingPurchaseFxTermsChangedPayload
>;
export type PurchasingPurchaseDiscrepancyRecordedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_DISCREPANCY_RECORDED,
  PurchasingPurchaseDiscrepancyRecordedPayload
>;
export type PurchasingPurchaseOrderShortClosedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_SHORT_CLOSED,
  PurchasingPurchaseOrderShortClosedPayload
>;
export type PurchasingPurchaseReturnCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_CREATED,
  PurchasingPurchaseReturnPayload
>;
export type PurchasingPurchaseReturnApprovedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_APPROVED,
  PurchasingPurchaseReturnPayload
>;
export type PurchasingPurchaseReturnCancelledEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_RETURN_CANCELLED,
  PurchasingPurchaseReturnPayload
>;

export type WarehouseCreatedPayload = {
  companyId: string;
  warehouseId: string;
  code: string;
};

export type WarehouseUpdatedPayload = {
  companyId: string;
  warehouseId: string;
  changedFields: string[];
};

export type WarehouseStatusChangedPayload = {
  companyId: string;
  warehouseId: string;
  previousStatus: string;
  newStatus: string;
};

export type WarehouseDefaultChangedPayload = {
  companyId: string;
  previousWarehouseId: string | null;
  newWarehouseId: string;
};

export type WarehouseCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_CREATED,
  WarehouseCreatedPayload
>;
export type WarehouseUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_UPDATED,
  WarehouseUpdatedPayload
>;
export type WarehouseActivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_ACTIVATED,
  WarehouseStatusChangedPayload
>;
export type WarehouseDeactivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_DEACTIVATED,
  WarehouseStatusChangedPayload
>;
export type WarehouseDefaultChangedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_DEFAULT_CHANGED,
  WarehouseDefaultChangedPayload
>;

export type WarehouseLocationCreatedPayload = {
  companyId: string;
  warehouseId: string;
  locationId: string;
  type: string;
  code: string;
};

export type WarehouseLocationUpdatedPayload = {
  companyId: string;
  warehouseId: string;
  locationId: string;
  changedFields: string[];
};

export type WarehouseLocationMovedPayload = {
  companyId: string;
  warehouseId: string;
  locationId: string;
  previousParentId: string | null;
  newParentId: string | null;
};

export type WarehouseLocationStatusChangedPayload = {
  companyId: string;
  warehouseId: string;
  locationId: string;
  previousStatus: string;
  newStatus: string;
};

export type WarehouseLocationCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_LOCATION_CREATED,
  WarehouseLocationCreatedPayload
>;
export type WarehouseLocationUpdatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_LOCATION_UPDATED,
  WarehouseLocationUpdatedPayload
>;
export type WarehouseLocationMovedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_LOCATION_MOVED,
  WarehouseLocationMovedPayload
>;
export type WarehouseLocationActivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_LOCATION_ACTIVATED,
  WarehouseLocationStatusChangedPayload
>;
export type WarehouseLocationDeactivatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_LOCATION_DEACTIVATED,
  WarehouseLocationStatusChangedPayload
>;

export type WarehouseGoodsReceiptCreatedPayload = {
  companyId: string;
  goodsReceiptId: string;
  purchaseOrderId: string;
  warehouseId: string;
  number: string;
};

export type WarehouseGoodsReceiptPostedPayload = {
  companyId: string;
  goodsReceiptId: string;
  purchaseOrderId: string;
  warehouseId: string;
  postedAt: string;
  itemIds: string[];
};

export type WarehouseGoodsReceiptCancelledPayload = {
  companyId: string;
  goodsReceiptId: string;
  purchaseOrderId: string;
};

export type WarehouseGoodsReceiptCreatedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_GOODS_RECEIPT_CREATED,
  WarehouseGoodsReceiptCreatedPayload
>;
export type WarehouseGoodsReceiptPostedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_GOODS_RECEIPT_POSTED,
  WarehouseGoodsReceiptPostedPayload
>;
export type WarehouseGoodsReceiptCancelledEvent = DomainEvent<
  typeof DOMAIN_EVENTS.WAREHOUSE_GOODS_RECEIPT_CANCELLED,
  WarehouseGoodsReceiptCancelledPayload
>;

export type PurchasingPurchaseOrderPartiallyReceivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_PARTIALLY_RECEIVED,
  PurchasingPurchaseOrderTransitionPayload
>;
export type PurchasingPurchaseOrderReceivedEvent = DomainEvent<
  typeof DOMAIN_EVENTS.PURCHASING_PURCHASE_ORDER_RECEIVED,
  PurchasingPurchaseOrderTransitionPayload
>;
