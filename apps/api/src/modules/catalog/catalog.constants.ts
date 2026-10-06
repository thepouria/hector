export const CATALOG_ERROR_MESSAGES = {
  PRODUCT_NOT_FOUND: 'Product not found in the current company.',
  PRODUCT_CODE_ALREADY_EXISTS: 'A product with this code already exists in the company.',
  PRODUCT_BRAND_NOT_FOUND: 'Brand not found in the current company.',
  PRODUCT_BRAND_NOT_ASSIGNABLE:
    'Brand is not assignable (must be ACTIVE). Existing references may remain.',
  PRODUCT_CATEGORY_NOT_FOUND: 'Category not found in the current company.',
  PRODUCT_CATEGORY_NOT_ASSIGNABLE:
    'Category is not assignable (must be ACTIVE with ACTIVE ancestors).',
  PRODUCT_ALREADY_ARCHIVED: 'Product is already archived.',
  PRODUCT_ACTIVATION_BLOCKED:
    'Product cannot be activated until Brand and Category references are assignable.',
  PRODUCT_NOT_ACTIVE: 'Product must be ACTIVE for this SKU operation.',
  SKU_NOT_FOUND: 'SKU not found in the current company.',
  SKU_CODE_ALREADY_EXISTS: 'A SKU with this code already exists in the company.',
  SKU_VARIANT_ALREADY_EXISTS:
    'A SKU with this variant combination already exists for the product.',
  SKU_SIMPLE_LIMIT:
    'A product without variant options may have at most one SKU (simple product).',
  SKU_VARIANT_INCOMPLETE: 'SKU must select exactly one value for each variant option.',
  SKU_VARIANT_DUPLICATE_OPTION: 'SKU cannot select multiple values for the same option.',
  SKU_VARIANT_VALUE_NOT_FOUND: 'Variant option value was not found for this product.',
  SKU_VARIANT_VALUE_INACTIVE: 'Inactive variant option values cannot be newly selected.',
  SKU_ALREADY_ARCHIVED: 'SKU is already archived.',
  SKU_ACTIVATION_BLOCKED: 'SKU cannot be activated until Product and variant selection are valid.',
  VARIANT_OPTION_NOT_FOUND: 'Variant option not found in the current company.',
  VARIANT_OPTION_NAME_EXISTS: 'A variant option with this name already exists on the product.',
  VARIANT_OPTION_HAS_SKUS:
    'Cannot remove or restructure a variant option that is referenced by existing SKUs.',
  VARIANT_OPTION_ADD_BLOCKED:
    'Cannot add a required variant option while the product already has SKUs.',
  VARIANT_VALUE_NOT_FOUND: 'Variant option value not found in the current company.',
  VARIANT_VALUE_EXISTS: 'A value with this label already exists for the option.',
  VARIANT_VALUE_IN_USE: 'Cannot remove a variant value that is referenced by existing SKUs.',
  BULK_SKU_LIMIT_EXCEEDED: 'Bulk SKU create exceeds the maximum allowed batch size.',
  BULK_SKU_DUPLICATE_IN_REQUEST: 'Bulk request contains duplicate SKU codes or combinations.',
  BARCODE_NOT_FOUND: 'Barcode not found in the current company.',
  BARCODE_NOT_ACTIVE: 'This barcode is archived and cannot be used for operational scans.',
  BARCODE_INVALID: 'Barcode value is invalid for the selected type.',
  BARCODE_INVALID_CHECKSUM: 'Barcode checksum is invalid.',
  BARCODE_ALREADY_EXISTS: 'This barcode is already assigned within the company.',
  BARCODE_ALREADY_ARCHIVED: 'Barcode is already archived.',
  INTERNAL_BARCODE_ALREADY_EXISTS:
    'This SKU already has an active INTERNAL barcode. Archive it before generating another.',
  PRIMARY_BARCODE_CONFLICT: 'Only one active primary barcode is allowed per SKU.',
  BRAND_NOT_FOUND: 'Brand not found in the current company.',
  CATEGORY_NOT_FOUND: 'Category not found in the current company.',
  BRAND_CODE_ALREADY_EXISTS: 'A brand with this code already exists in the company.',
  BRAND_NAME_ALREADY_EXISTS: 'A brand with this name already exists in the company.',
  CATEGORY_CODE_ALREADY_EXISTS: 'A category with this code already exists in the company.',
  CATEGORY_NAME_ALREADY_EXISTS: 'A category with this name already exists under the same parent.',
  CATEGORY_PARENT_NOT_FOUND: 'Parent category was not found in the current company.',
  CATEGORY_CROSS_COMPANY_PARENT: 'Parent category does not belong to the current company.',
  CATEGORY_CYCLE_DETECTED: 'Moving this category would create a cycle in the category tree.',
  CATEGORY_INVALID_PARENT: 'The selected parent category is not valid.',
  CATEGORY_DEPTH_EXCEEDED: 'Category depth exceeds the maximum allowed depth.',
  CROSS_COMPANY_REFERENCE: 'The referenced catalog record does not belong to the current company.',
  CATALOG_ITEM_ARCHIVED: 'Archived catalog items cannot be modified this way.',
  INVALID_SKU_CODE:
    'SKU code must contain only A–Z, 0–9, hyphen, underscore, and period after normalization.',
  INVALID_PRODUCT_CODE:
    'Product code must contain only A–Z, 0–9, hyphen, and underscore after normalization.',
  INVALID_BRAND_CODE:
    'Brand code must contain only A–Z, 0–9, hyphen, and underscore after normalization.',
  INVALID_CATEGORY_CODE:
    'Category code must contain only A–Z, 0–9, hyphen, and underscore after normalization.',
  INVALID_ATTRIBUTE_CODE:
    'Attribute code must contain only a–z, 0–9, and underscore after normalization.',
  BARCODE_EMPTY: 'Barcode value must not be empty.',
  NAME_REQUIRED: 'Name is required.',
  ATTRIBUTE_NOT_FOUND: 'Attribute not found in the current company.',
  ATTRIBUTE_CODE_ALREADY_EXISTS: 'An attribute with this code already exists in the company.',
  ATTRIBUTE_ALREADY_ARCHIVED: 'Attribute is already archived.',
  ATTRIBUTE_TYPE_CHANGE_BLOCKED:
    'Attribute type cannot change after values or options exist. Archive and create a new attribute instead.',
  ATTRIBUTE_SCOPE_MISMATCH: 'This attribute cannot be used on the requested entity (scope mismatch).',
  ATTRIBUTE_NOT_ACTIVE: 'Archived attributes cannot receive new values.',
  ATTRIBUTE_OPTION_NOT_FOUND: 'Attribute option not found in the current company.',
  ATTRIBUTE_OPTION_EXISTS: 'An option with this value already exists for the attribute.',
  ATTRIBUTE_OPTION_INACTIVE: 'Inactive attribute options cannot be newly selected.',
  ATTRIBUTE_OPTION_WRONG_ATTRIBUTE: 'Selected option does not belong to the requested attribute.',
  ATTRIBUTE_VALUE_INVALID: 'Attribute value is invalid for the attribute type.',
  ATTRIBUTE_SELECT_REQUIRED_TYPE:
    'Options are only valid for SINGLE_SELECT and MULTI_SELECT attributes.',
  BULK_EMPTY_SELECTION: 'Bulk selection must include at least one entity id.',
  BULK_IDS_LIMIT_EXCEEDED: 'Bulk explicit id selection exceeds the maximum allowed size.',
  BULK_QUERY_UNSAFE:
    'Empty query selection is not allowed. Provide filters or set selectAll=true intentionally.',
  BULK_QUERY_LIMIT_EXCEEDED: 'Bulk query selection matched more entities than the sync limit allows.',
  BULK_OPERATION_NOT_FOUND: 'Bulk operation not found in the current company.',
  BULK_INVALID_OPERATION: 'Unknown or unsupported bulk operation.',
  BULK_INVALID_PAYLOAD: 'Bulk operation payload is invalid for the selected operation.',
} as const;

export const PRODUCT_NAME_MAX_LENGTH = 200;
export const PRODUCT_CODE_MAX_LENGTH = 64;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 2000;
export const SKU_CODE_MAX_LENGTH = 64;
export const SKU_NAME_MAX_LENGTH = 200;
export const BRAND_NAME_MAX_LENGTH = 120;
export const BRAND_CODE_MAX_LENGTH = 64;
export const CATEGORY_NAME_MAX_LENGTH = 120;
export const CATEGORY_CODE_MAX_LENGTH = 64;
/** Practical scanner input / storage limit (Phase 1.5). */
export const BARCODE_VALUE_MAX_LENGTH = 128;

/** Retries when an INTERNAL barcode collides with an existing company value. */
export const INTERNAL_BARCODE_GENERATION_RETRIES = 5;
export const CATALOG_SEARCH_MAX_LENGTH = 100;
/** Default row cap for GET /catalog/lookup. */
export const CATALOG_LOOKUP_DEFAULT_LIMIT = 15;
/** Hard max for GET /catalog/lookup ?limit=. */
export const CATALOG_LOOKUP_MAX_LIMIT = 20;
export const VARIANT_OPTION_NAME_MAX_LENGTH = 80;
export const VARIANT_VALUE_MAX_LENGTH = 80;
export const ATTRIBUTE_NAME_MAX_LENGTH = 120;
export const ATTRIBUTE_CODE_MAX_LENGTH = 64;
export const ATTRIBUTE_UNIT_MAX_LENGTH = 32;
export const ATTRIBUTE_DESCRIPTION_MAX_LENGTH = 500;
export const ATTRIBUTE_TEXT_VALUE_MAX_LENGTH = 500;
export const ATTRIBUTE_OPTION_VALUE_MAX_LENGTH = 120;

export const ATTRIBUTE_SORT_FIELDS = ['name', 'code', 'createdAt', 'updatedAt'] as const;
export type AttributeSortField = (typeof ATTRIBUTE_SORT_FIELDS)[number];

/** Protects against pathological trees; adjacency-list traversal remains O(n). */
export const CATEGORY_MAX_DEPTH = 20;

/** Product/Brand/Category codes: A-Z, 0-9, hyphen, underscore. */
export const INTERNAL_CODE_PATTERN = /^[A-Z0-9_-]+$/;

/** Attribute integration codes: lowercase a-z, 0-9, underscore. */
export const ATTRIBUTE_CODE_PATTERN = /^[a-z0-9_]+$/;

/** SKU codes additionally allow period (e.g. FAN.SL.01). */
export const SKU_CODE_PATTERN = /^[A-Z0-9._-]+$/;

/** Max SKUs per bulk create request (all-or-nothing). */
export const BULK_SKU_MAX = 250;

/** Max Cartesian combinations the UI may generate before refusing. */
export const VARIANT_GENERATION_MAX = 250;

/** Explicit-ID bulk selection cap (Phase 1.10). */
export const BULK_IDS_MAX = 1000;
/** Sync QUERY selection resolve cap — larger sets need future async jobs. */
export const BULK_QUERY_RESOLVE_MAX = 5000;
/** Bounded failure details returned to clients. */
export const BULK_FAILURE_DETAILS_MAX = 50;
/** Preview sample rows. */
export const BULK_PREVIEW_SAMPLE_MAX = 10;

export const BULK_OPERATIONS = {
  PRODUCT_CHANGE_BRAND: 'PRODUCT_CHANGE_BRAND',
  PRODUCT_CHANGE_CATEGORY: 'PRODUCT_CHANGE_CATEGORY',
  PRODUCT_ACTIVATE: 'PRODUCT_ACTIVATE',
  PRODUCT_DEACTIVATE: 'PRODUCT_DEACTIVATE',
  PRODUCT_ARCHIVE: 'PRODUCT_ARCHIVE',
  SKU_ACTIVATE: 'SKU_ACTIVATE',
  SKU_DEACTIVATE: 'SKU_DEACTIVATE',
  SKU_ARCHIVE: 'SKU_ARCHIVE',
  PRODUCT_ATTRIBUTE_SET: 'PRODUCT_ATTRIBUTE_SET',
  PRODUCT_ATTRIBUTE_REMOVE: 'PRODUCT_ATTRIBUTE_REMOVE',
  SKU_ATTRIBUTE_SET: 'SKU_ATTRIBUTE_SET',
  SKU_ATTRIBUTE_REMOVE: 'SKU_ATTRIBUTE_REMOVE',
} as const;

export type BulkOperationType = (typeof BULK_OPERATIONS)[keyof typeof BULK_OPERATIONS];

export const BULK_OPERATION_VALUES = Object.values(BULK_OPERATIONS);

export const BRAND_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;
export type BrandSortField = (typeof BRAND_SORT_FIELDS)[number];

export const CATEGORY_SORT_FIELDS = ['name', 'sortOrder', 'createdAt', 'updatedAt'] as const;
export type CategorySortField = (typeof CATEGORY_SORT_FIELDS)[number];

export const PRODUCT_SORT_FIELDS = [
  'name',
  'code',
  'createdAt',
  'updatedAt',
  'status',
] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

export const SKU_SORT_FIELDS = ['code', 'name', 'createdAt', 'updatedAt', 'status'] as const;
export type SkuSortField = (typeof SKU_SORT_FIELDS)[number];
