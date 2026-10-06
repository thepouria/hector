import { AttributeScope, AttributeType, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  ATTRIBUTE_TEXT_VALUE_MAX_LENGTH,
  CATALOG_ERROR_MESSAGES,
} from './catalog.constants';
import { normalizeCatalogNameKey, normalizeDisplayName } from './catalog.normalization';

export type AttributeOptionRef = {
  id: string;
  attributeDefinitionId: string;
  isActive: boolean;
  value: string;
};

export type IncomingAttributeValueInput = {
  attributeId: string;
  textValue?: string | null;
  numberValue?: number | null;
  booleanValue?: boolean | null;
  optionIds?: string[] | null;
};

/**
 * Normalized persisted form. `null` means "clear / do not store a row".
 * Boolean `false` is a real value and must be persisted.
 */
export type NormalizedAttributeValue =
  | {
      kind: 'clear';
      attributeId: string;
    }
  | {
      kind: 'text';
      attributeId: string;
      textValue: string;
    }
  | {
      kind: 'number';
      attributeId: string;
      numberValue: Prisma.Decimal;
    }
  | {
      kind: 'boolean';
      attributeId: string;
      booleanValue: boolean;
    }
  | {
      kind: 'select';
      attributeId: string;
      optionIds: string[];
    };

export function assertAttributeScopeAllows(
  scope: AttributeScope,
  target: 'PRODUCT' | 'SKU',
): void {
  if (scope === AttributeScope.BOTH) return;
  if (scope === AttributeScope.PRODUCT && target === 'PRODUCT') return;
  if (scope === AttributeScope.SKU && target === 'SKU') return;
  throw new AppError({
    code: ERROR_CODES.ATTRIBUTE_SCOPE_MISMATCH,
    message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_SCOPE_MISMATCH,
    statusCode: 400,
  });
}

/**
 * Validate and normalize one incoming Attribute value against its Definition type.
 * Empty / unspecified inputs normalize to `clear` (no persisted row).
 * Missing boolean must NOT become false.
 */
export function normalizeAttributeValueInput(
  type: AttributeType,
  attributeId: string,
  input: IncomingAttributeValueInput,
  optionsById: Map<string, AttributeOptionRef>,
): NormalizedAttributeValue {
  switch (type) {
    case AttributeType.TEXT: {
      if (input.textValue === undefined || input.textValue === null) {
        return { kind: 'clear', attributeId };
      }
      const text = normalizeDisplayName(String(input.textValue));
      if (text.length === 0) {
        return { kind: 'clear', attributeId };
      }
      if (text.length > ATTRIBUTE_TEXT_VALUE_MAX_LENGTH) {
        throw invalidValue();
      }
      return { kind: 'text', attributeId, textValue: text };
    }
    case AttributeType.NUMBER: {
      if (input.numberValue === undefined || input.numberValue === null) {
        return { kind: 'clear', attributeId };
      }
      if (typeof input.numberValue !== 'number' || !Number.isFinite(input.numberValue)) {
        throw invalidValue();
      }
      return {
        kind: 'number',
        attributeId,
        numberValue: new Prisma.Decimal(input.numberValue),
      };
    }
    case AttributeType.BOOLEAN: {
      // undefined/null = unspecified (clear). false is a real value.
      if (input.booleanValue === undefined || input.booleanValue === null) {
        return { kind: 'clear', attributeId };
      }
      if (typeof input.booleanValue !== 'boolean') {
        throw invalidValue();
      }
      return { kind: 'boolean', attributeId, booleanValue: input.booleanValue };
    }
    case AttributeType.SINGLE_SELECT: {
      const ids = uniqueOptionIds(input.optionIds);
      if (ids.length === 0) {
        return { kind: 'clear', attributeId };
      }
      if (ids.length > 1) {
        throw invalidValue();
      }
      assertActiveOption(ids[0]!, attributeId, optionsById);
      return { kind: 'select', attributeId, optionIds: ids };
    }
    case AttributeType.MULTI_SELECT: {
      const ids = uniqueOptionIds(input.optionIds);
      if (ids.length === 0) {
        return { kind: 'clear', attributeId };
      }
      for (const id of ids) {
        assertActiveOption(id, attributeId, optionsById);
      }
      return { kind: 'select', attributeId, optionIds: ids };
    }
    default: {
      const _exhaustive: never = type;
      throw invalidValue();
      void _exhaustive;
    }
  }
}

export function normalizeOptionValue(value: string): { value: string; normalizedValue: string } {
  const display = normalizeDisplayName(value);
  if (display.length === 0) {
    throw new AppError({
      code: ERROR_CODES.ATTRIBUTE_VALUE_INVALID,
      message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_VALUE_INVALID,
      statusCode: 400,
    });
  }
  return { value: display, normalizedValue: normalizeCatalogNameKey(display) };
}

function uniqueOptionIds(raw: string[] | null | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (typeof id !== 'string' || id.length === 0) {
      throw invalidValue();
    }
    if (seen.has(id)) {
      throw invalidValue();
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function assertActiveOption(
  optionId: string,
  attributeId: string,
  optionsById: Map<string, AttributeOptionRef>,
): void {
  const option = optionsById.get(optionId);
  if (!option) {
    throw new AppError({
      code: ERROR_CODES.ATTRIBUTE_OPTION_NOT_FOUND,
      message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_OPTION_NOT_FOUND,
      statusCode: 404,
    });
  }
  if (option.attributeDefinitionId !== attributeId) {
    throw new AppError({
      code: ERROR_CODES.ATTRIBUTE_OPTION_WRONG_ATTRIBUTE,
      message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_OPTION_WRONG_ATTRIBUTE,
      statusCode: 400,
    });
  }
  if (!option.isActive) {
    throw new AppError({
      code: ERROR_CODES.ATTRIBUTE_OPTION_INACTIVE,
      message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_OPTION_INACTIVE,
      statusCode: 400,
    });
  }
}

function invalidValue(): AppError {
  return new AppError({
    code: ERROR_CODES.ATTRIBUTE_VALUE_INVALID,
    message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_VALUE_INVALID,
    statusCode: 400,
  });
}
