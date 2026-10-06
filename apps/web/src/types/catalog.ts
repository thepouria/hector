export type CatalogLifecycleStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type Brand = {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  status: CatalogLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type Category = {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  parentId: string | null;
  sortOrder: number;
  status: CatalogLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  path?: string;
};

export type CategoryTreeNode = {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  status: CatalogLifecycleStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  children: CategoryTreeNode[];
};

export type Product = {
  id: string;
  companyId: string;
  name: string;
  code: string | null;
  description: string | null;
  brandId: string | null;
  categoryId: string | null;
  brand: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  categoryPath: string | null;
  /** Present on list/detail (Phase 1.7). */
  skuCount?: number;
  /** Detail only; null on list projections. */
  activeSkuCount?: number | null;
  status: CatalogLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ProductRef = {
  id: string;
  name: string;
  code: string | null;
  status: CatalogLifecycleStatus;
};

export type SkuVariantValue = {
  optionId: string;
  optionName: string;
  optionPosition: number;
  optionValueId: string;
  value: string;
  valuePosition: number;
  isActive: boolean;
};

export type Sku = {
  id: string;
  companyId: string;
  productId: string;
  code: string;
  normalizedCode: string;
  name: string | null;
  /** `SIMPLE` for products without variant options. */
  variantSignature: string;
  status: CatalogLifecycleStatus;
  product: ProductRef;
  variantValues: SkuVariantValue[];
  /** True when the SKU has at least one active (non-archived) barcode. */
  hasBarcode?: boolean;
  primaryBarcode?: { id: string; value: string; type: string } | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type VariantOptionValue = {
  id: string;
  companyId: string;
  optionId: string;
  value: string;
  position: number;
  isActive: boolean;
  skuCount: number;
  createdAt: string;
  updatedAt: string;
};

export type VariantOption = {
  id: string;
  companyId: string;
  productId: string;
  name: string;
  position: number;
  values: VariantOptionValue[];
  createdAt: string;
  updatedAt: string;
};

export type BarcodeType = 'EAN13' | 'EAN8' | 'UPC_A' | 'CODE128' | 'INTERNAL' | 'OTHER';

export type Barcode = {
  id: string;
  companyId: string;
  skuId: string;
  value: string;
  normalizedValue: string;
  type: BarcodeType;
  isPrimary: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BarcodeResolveResult = {
  barcode: Barcode;
  sku: Sku;
  product: Product;
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

/** Identity counts only — Catalog never exposes inventory, cost, or price. */
export type CatalogStats = {
  brands: number;
  categories: number;
  products: number;
  skus: number;
  barcodes: number;
  attributes: number;
};

export type AttributeType =
  | 'TEXT'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'SINGLE_SELECT'
  | 'MULTI_SELECT';

export type AttributeScope = 'PRODUCT' | 'SKU' | 'BOTH';

export type AttributeOption = {
  id: string;
  attributeDefinitionId: string;
  value: string;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AttributeDefinition = {
  id: string;
  companyId: string;
  name: string;
  code: string;
  type: AttributeType;
  scope: AttributeScope;
  unit: string | null;
  description: string | null;
  status: CatalogLifecycleStatus;
  options?: AttributeOption[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CategoryAttributeAssignment = {
  attributeId: string;
  attribute: AttributeDefinition;
  position: number;
  isVisible: boolean;
};

export type CategoryAttributeSuggestion = {
  attributeId: string;
  attribute: AttributeDefinition;
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

export type EntityAttributeValue = {
  attributeId: string;
  attribute: EntityAttributeDefinitionRef;
  textValue: string | null;
  numberValue: string | null;
  booleanValue: boolean | null;
  selectedOptions: EntityAttributeOptionRef[];
};

export type PutEntityAttributeItem = {
  attributeId: string;
  textValue?: string | null;
  numberValue?: number | null;
  booleanValue?: boolean | null;
  optionIds?: string[] | null;
};
