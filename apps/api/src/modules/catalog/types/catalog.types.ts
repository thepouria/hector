import {
  AttributeScope,
  AttributeType,
  CatalogLifecycleStatus,
  BarcodeType,
} from '@hector/database';

export type CatalogOptionView = {
  id: string;
  name: string;
  code: string | null;
  status: CatalogLifecycleStatus;
};

export type BrandView = {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  status: CatalogLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type CategoryView = {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  parentId: string | null;
  sortOrder: number;
  status: CatalogLifecycleStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type ProductRelationRef = {
  id: string;
  name: string;
};

export type ProductView = {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  description: string | null;
  brandId: string | null;
  categoryId: string | null;
  brand: ProductRelationRef | null;
  category: ProductRelationRef | null;
  /** Breadcrumb path when available (detail); omitted/null on list for performance. */
  categoryPath: string | null;
  status: CatalogLifecycleStatus;
  skuCount: number;
  /** Set on detail reads; null on list responses. */
  activeSkuCount: number | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type SkuProductRef = {
  id: string;
  name: string;
  code: string | null;
  status: CatalogLifecycleStatus;
};

export type SkuVariantValueView = {
  optionId: string;
  optionName: string;
  optionPosition: number;
  optionValueId: string;
  value: string;
  valuePosition: number;
  isActive: boolean;
};

export type SkuPrimaryBarcodeRef = {
  id: string;
  value: string;
  type: BarcodeType;
};

export type SkuView = {
  id: string;
  companyId: string;
  productId: string;
  code: string;
  normalizedCode: string;
  name: string | null;
  /** `SIMPLE` for zero-option products; otherwise server-built option/value ID signature. */
  variantSignature: string;
  status: CatalogLifecycleStatus;
  product: SkuProductRef;
  variantValues: SkuVariantValueView[];
  /** Populated on list reads when barcode summary is loaded. */
  hasBarcode?: boolean;
  primaryBarcode: SkuPrimaryBarcodeRef | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type VariantOptionValueView = {
  id: string;
  companyId: string;
  optionId: string;
  value: string;
  position: number;
  isActive: boolean;
  /** Number of SKUs currently linked to this value. */
  skuCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type VariantOptionView = {
  id: string;
  companyId: string;
  productId: string;
  name: string;
  position: number;
  values: VariantOptionValueView[];
  createdAt: Date;
  updatedAt: Date;
};

export type BarcodeView = {
  id: string;
  companyId: string;
  skuId: string;
  value: string;
  normalizedValue: string;
  type: BarcodeType;
  isPrimary: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BarcodeLookupView = {
  barcode: BarcodeView;
  sku: SkuView;
  product: ProductView;
};

export type CatalogLookupType = 'PRODUCT' | 'SKU' | 'BARCODE';

export type CatalogLookupHit = {
  type: CatalogLookupType;
  id: string;
  label: string;
  sublabel: string | null;
  productId: string | null;
  skuId: string | null;
  status: CatalogLifecycleStatus;
};

export type SkuIdentityView = {
  skuId: string;
  skuCode: string;
  skuName: string | null;
  skuStatus: CatalogLifecycleStatus;
  productId: string;
  productName: string;
  productCode: string | null;
  productStatus: CatalogLifecycleStatus;
  primaryBarcode: SkuPrimaryBarcodeRef | null;
};

export type CatalogStatsView = {
  brands: number;
  categories: number;
  products: number;
  skus: number;
  barcodes: number;
  attributes: number;
};

export type AttributeOptionView = {
  id: string;
  attributeDefinitionId: string;
  value: string;
  position: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AttributeDefinitionView = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  type: AttributeType;
  scope: AttributeScope;
  unit: string | null;
  description: string | null;
  status: CatalogLifecycleStatus;
  options?: AttributeOptionView[];
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type CategoryAttributeAssignmentView = {
  attributeId: string;
  attribute: AttributeDefinitionView;
  position: number;
  isVisible: boolean;
};

export type CategoryAttributeSuggestionView = {
  attributeId: string;
  attribute: AttributeDefinitionView;
  position: number;
  isVisible: boolean;
  sourceCategoryId: string;
};

export type EntityAttributeDefinitionRef = {
  id: string;
  name: string;
  code: string;
  type: AttributeType;
  scope: AttributeScope;
  unit: string | null;
  status: CatalogLifecycleStatus;
};

export type EntityAttributeOptionRef = {
  id: string;
  value: string;
  isActive: boolean;
};

export type EntityAttributeValueView = {
  attributeId: string;
  attribute: EntityAttributeDefinitionRef;
  textValue: string | null;
  numberValue: string | null;
  booleanValue: boolean | null;
  selectedOptions: EntityAttributeOptionRef[];
};
