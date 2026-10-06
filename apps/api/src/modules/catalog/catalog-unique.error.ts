import { Prisma } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import { ERROR_CODES, type ErrorCode } from '../../common/constants';
import { CATALOG_ERROR_MESSAGES } from './catalog.constants';

type UniqueTarget =
  | 'sku_code'
  | 'sku_variant'
  | 'product_code'
  | 'brand_code'
  | 'brand_name'
  | 'category_code'
  | 'category_name'
  | 'barcode_value'
  | 'variant_option_name'
  | 'variant_value'
  | 'attribute_code'
  | 'attribute_option'
  | 'category_attribute'
  | 'product_attribute'
  | 'sku_attribute'
  | 'unknown';

function targetFromMeta(error: Prisma.PrismaClientKnownRequestError): UniqueTarget {
  const target = error.meta?.target;
  const fields = Array.isArray(target)
    ? target.map(String)
    : typeof target === 'string'
      ? [target]
      : [];

  const joined = fields.join(',').toLowerCase();
  if (
    joined.includes('barcode') ||
    fields.includes('value') ||
    fields.includes('normalized_value') ||
    joined.includes('normalized_value') ||
    joined.includes('company_id_value') ||
    joined.includes('company_id_normalized_value')
  ) {
    return 'barcode_value';
  }
  if (joined.includes('one_primary') || joined.includes('one_active_internal')) {
    return 'barcode_value';
  }
  if (joined.includes('normalized_name') && joined.includes('brand')) {
    return 'brand_name';
  }
  if (joined.includes('normalized_name') && (joined.includes('categor') || joined.includes('parent'))) {
    return 'category_name';
  }
  if (joined.includes('brands') && fields.includes('code')) {
    return 'brand_code';
  }
  if (joined.includes('categories') && fields.includes('code')) {
    return 'category_code';
  }
  if (joined.includes('skus') || (fields.includes('code') && joined.includes('sku'))) {
    return 'sku_code';
  }
  if (joined.includes('normalized_code') && joined.includes('sku')) {
    return 'sku_code';
  }
  if (joined.includes('variant_signature')) {
    return 'sku_variant';
  }
  if (joined.includes('products') && (fields.includes('code') || joined.includes('normalized_code'))) {
    return 'product_code';
  }
  if (joined.includes('variant_options') && joined.includes('normalized_name')) {
    return 'variant_option_name';
  }
  if (joined.includes('variant_option_values') && joined.includes('normalized_value')) {
    return 'variant_value';
  }
  if (
    joined.includes('attribute_definitions') ||
    (joined.includes('normalized_code') && joined.includes('attribute'))
  ) {
    return 'attribute_code';
  }
  if (joined.includes('attribute_options') && joined.includes('normalized_value')) {
    return 'attribute_option';
  }
  if (joined.includes('category_attributes')) {
    return 'category_attribute';
  }
  if (joined.includes('product_attribute_values')) {
    return 'product_attribute';
  }
  if (joined.includes('sku_attribute_values')) {
    return 'sku_attribute';
  }
  if (joined.includes('normalized_name')) {
    // Ambiguous — prefer brand_name if constraint name hints brands
    if (joined.includes('brand')) return 'brand_name';
    return 'category_name';
  }
  if (fields.includes('value')) {
    return 'barcode_value';
  }
  return 'unknown';
}

/**
 * Maps Prisma unique violations to catalog domain errors.
 * Database unique constraints remain the final authority under concurrency.
 */
export function mapCatalogUniqueViolation(
  error: unknown,
  hint?: UniqueTarget,
): never {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    throw error;
  }

  const target = hint ?? targetFromMeta(error);

  const mapping: Record<UniqueTarget, { code: ErrorCode; message: string }> = {
    sku_code: {
      code: ERROR_CODES.SKU_CODE_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.SKU_CODE_ALREADY_EXISTS,
    },
    sku_variant: {
      code: ERROR_CODES.SKU_VARIANT_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.SKU_VARIANT_ALREADY_EXISTS,
    },
    product_code: {
      code: ERROR_CODES.PRODUCT_CODE_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.PRODUCT_CODE_ALREADY_EXISTS,
    },
    brand_code: {
      code: ERROR_CODES.BRAND_CODE_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.BRAND_CODE_ALREADY_EXISTS,
    },
    brand_name: {
      code: ERROR_CODES.BRAND_NAME_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.BRAND_NAME_ALREADY_EXISTS,
    },
    category_code: {
      code: ERROR_CODES.CATEGORY_CODE_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.CATEGORY_CODE_ALREADY_EXISTS,
    },
    category_name: {
      code: ERROR_CODES.CATEGORY_NAME_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.CATEGORY_NAME_ALREADY_EXISTS,
    },
    barcode_value: {
      code: ERROR_CODES.BARCODE_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.BARCODE_ALREADY_EXISTS,
    },
    variant_option_name: {
      code: ERROR_CODES.VARIANT_OPTION_NAME_EXISTS,
      message: CATALOG_ERROR_MESSAGES.VARIANT_OPTION_NAME_EXISTS,
    },
    variant_value: {
      code: ERROR_CODES.VARIANT_VALUE_EXISTS,
      message: CATALOG_ERROR_MESSAGES.VARIANT_VALUE_EXISTS,
    },
    attribute_code: {
      code: ERROR_CODES.ATTRIBUTE_CODE_ALREADY_EXISTS,
      message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_CODE_ALREADY_EXISTS,
    },
    attribute_option: {
      code: ERROR_CODES.ATTRIBUTE_OPTION_EXISTS,
      message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_OPTION_EXISTS,
    },
    category_attribute: {
      code: ERROR_CODES.CONFLICT,
      message: 'This attribute is already assigned to the category.',
    },
    product_attribute: {
      code: ERROR_CODES.CONFLICT,
      message: 'A product attribute value for this attribute already exists.',
    },
    sku_attribute: {
      code: ERROR_CODES.CONFLICT,
      message: 'A SKU attribute value for this attribute already exists.',
    },
    unknown: {
      code: ERROR_CODES.CONFLICT,
      message: 'The requested resource conflicts with an existing record.',
    },
  };

  const mapped = mapping[target];
  throw new AppError({
    code: mapped.code,
    message: mapped.message,
    statusCode: 409,
  });
}
