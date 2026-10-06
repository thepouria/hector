import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { CATALOG_ERROR_MESSAGES } from './catalog.constants';
import { buildVariantSignature, SIMPLE_VARIANT_SIGNATURE, type VariantPair } from './variant-signature.util';

export type VariantOptionWithValues = {
  id: string;
  name: string;
  values: Array<{ id: string; value: string; isActive: boolean }>;
};

export type ResolvedVariantSelection = {
  pairs: VariantPair[];
  signature: string;
  /** Sorted option value IDs (stable for audit). */
  optionValueIds: string[];
};

function variantError(
  code: keyof typeof ERROR_CODES,
  message: string,
  statusCode: number,
): AppError {
  return new AppError({ code: ERROR_CODES[code], message, statusCode });
}

/**
 * Resolves a client-supplied list of option value IDs against the product's own options.
 * Pure (no I/O). The signature is always computed server-side from validated IDs.
 *
 * - Zero options → only an empty selection is valid → SIMPLE
 * - Exactly one value per option; every option covered
 * - Values must belong to the product's options (cross-product / cross-company IDs are rejected)
 * - Inactive values are rejected unless listed in `allowInactiveIds` (existing assignment retained)
 */
export function resolveVariantSelection(
  options: VariantOptionWithValues[],
  optionValueIds: string[] | undefined,
  allowInactiveIds: ReadonlySet<string> = new Set(),
): ResolvedVariantSelection {
  const ids = optionValueIds ?? [];

  if (new Set(ids).size !== ids.length) {
    throw variantError(
      'SKU_VARIANT_DUPLICATE_OPTION',
      CATALOG_ERROR_MESSAGES.SKU_VARIANT_DUPLICATE_OPTION,
      400,
    );
  }

  if (options.length === 0) {
    if (ids.length > 0) {
      throw variantError(
        'SKU_VARIANT_VALUE_NOT_FOUND',
        CATALOG_ERROR_MESSAGES.SKU_VARIANT_VALUE_NOT_FOUND,
        400,
      );
    }
    return { pairs: [], signature: SIMPLE_VARIANT_SIGNATURE, optionValueIds: [] };
  }

  const valueIndex = new Map<string, { optionId: string; isActive: boolean }>();
  for (const option of options) {
    for (const value of option.values) {
      valueIndex.set(value.id, { optionId: option.id, isActive: value.isActive });
    }
  }

  const chosen = new Map<string, string>();
  for (const id of ids) {
    const entry = valueIndex.get(id);
    if (!entry) {
      throw variantError(
        'SKU_VARIANT_VALUE_NOT_FOUND',
        CATALOG_ERROR_MESSAGES.SKU_VARIANT_VALUE_NOT_FOUND,
        400,
      );
    }
    if (chosen.has(entry.optionId)) {
      throw variantError(
        'SKU_VARIANT_DUPLICATE_OPTION',
        CATALOG_ERROR_MESSAGES.SKU_VARIANT_DUPLICATE_OPTION,
        400,
      );
    }
    if (!entry.isActive && !allowInactiveIds.has(id)) {
      throw variantError(
        'SKU_VARIANT_VALUE_INACTIVE',
        CATALOG_ERROR_MESSAGES.SKU_VARIANT_VALUE_INACTIVE,
        409,
      );
    }
    chosen.set(entry.optionId, id);
  }

  if (chosen.size !== options.length) {
    throw variantError(
      'SKU_VARIANT_INCOMPLETE',
      CATALOG_ERROR_MESSAGES.SKU_VARIANT_INCOMPLETE,
      400,
    );
  }

  const pairs: VariantPair[] = [...chosen.entries()].map(([optionId, optionValueId]) => ({
    optionId,
    optionValueId,
  }));

  return {
    pairs,
    signature: buildVariantSignature(pairs),
    optionValueIds: [...ids].sort(),
  };
}
