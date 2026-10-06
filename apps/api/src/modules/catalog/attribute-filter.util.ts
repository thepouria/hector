/**
 * Structured Product Attribute list filters (Phase 1.9).
 *
 * Query format (comma-separated):
 *   attrs=spf:gte:30,oil_free:eq:true,finish:eq:<optionUuid>
 *   attrs=spf:hasValue:false
 *
 * Attribute identity is always `code` (stable), never display name.
 * Filtering never implies Attribute values are required on Products.
 */

import { AttributeType, Prisma } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import { CATALOG_ERROR_MESSAGES } from './catalog.constants';
import { normalizeAttributeCode, normalizeCatalogNameKey } from './catalog.normalization';

export const ATTRIBUTE_FILTER_OPS = [
  'eq',
  'contains',
  'gte',
  'lte',
  'in',
  'containsAny',
  'containsAll',
  'hasValue',
] as const;

export type AttributeFilterOp = (typeof ATTRIBUTE_FILTER_OPS)[number];

export type ParsedAttributeFilter = {
  code: string;
  op: AttributeFilterOp;
  /** Raw value string after the second colon (may contain colons). */
  rawValue: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPS_BY_TYPE: Record<AttributeType, ReadonlySet<AttributeFilterOp>> = {
  TEXT: new Set(['eq', 'contains', 'hasValue']),
  NUMBER: new Set(['eq', 'gte', 'lte', 'hasValue']),
  BOOLEAN: new Set(['eq', 'hasValue']),
  SINGLE_SELECT: new Set(['eq', 'in', 'hasValue']),
  MULTI_SELECT: new Set(['containsAny', 'containsAll', 'hasValue']),
};

export function parseAttributeFiltersParam(
  raw: string | undefined | null,
): ParsedAttributeFilter[] {
  if (raw === undefined || raw === null) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length > 20) {
    throw invalidAttributeFilter('Too many attribute filters (max 20).');
  }

  return parts.map((part) => {
    const first = part.indexOf(':');
    const second = first >= 0 ? part.indexOf(':', first + 1) : -1;
    if (first <= 0 || second <= first) {
      throw invalidAttributeFilter(
        `Invalid attrs segment "${part}". Expected code:op:value.`,
      );
    }
    const code = normalizeAttributeCode(part.slice(0, first));
    const opRaw = part.slice(first + 1, second).trim();
    const rawValue = part.slice(second + 1);
    if (!code) {
      throw invalidAttributeFilter(`Invalid attribute code in "${part}".`);
    }
    if (!(ATTRIBUTE_FILTER_OPS as readonly string[]).includes(opRaw)) {
      throw invalidAttributeFilter(`Unsupported attribute operator "${opRaw}".`);
    }
    return { code, op: opRaw as AttributeFilterOp, rawValue };
  });
}

export function assertOperatorForType(type: AttributeType, op: AttributeFilterOp): void {
  if (!OPS_BY_TYPE[type].has(op)) {
    throw invalidAttributeFilter(
      `Operator "${op}" is not valid for attribute type ${type}.`,
    );
  }
}

export type AttributeDefinitionForFilter = {
  id: string;
  code: string;
  type: AttributeType;
};

/**
 * Build Prisma Product where clauses for attribute filters.
 * Resolves definitions by company + normalized code.
 */
export async function buildProductAttributeWhereClauses(
  companyId: string,
  filters: ParsedAttributeFilter[],
  findDefinitions: (
    companyId: string,
    codes: string[],
  ) => Promise<AttributeDefinitionForFilter[]>,
): Promise<Prisma.ProductWhereInput[]> {
  if (filters.length === 0) return [];

  const codes = [...new Set(filters.map((f) => f.code))];
  const definitions = await findDefinitions(companyId, codes);
  const byCode = new Map(definitions.map((d) => [d.code, d]));

  const clauses: Prisma.ProductWhereInput[] = [];

  for (const filter of filters) {
    const definition = byCode.get(filter.code);
    if (!definition) {
      throw new AppError({
        code: ERROR_CODES.ATTRIBUTE_NOT_FOUND,
        message: CATALOG_ERROR_MESSAGES.ATTRIBUTE_NOT_FOUND,
        statusCode: 404,
        details: { code: filter.code },
      });
    }
    assertOperatorForType(definition.type, filter.op);
    clauses.push(toProductWhere(definition, filter));
  }

  return clauses;
}

function toProductWhere(
  definition: AttributeDefinitionForFilter,
  filter: ParsedAttributeFilter,
): Prisma.ProductWhereInput {
  const attributeDefinitionId = definition.id;

  if (filter.op === 'hasValue') {
    const want = parseHasValue(filter.rawValue);
    if (want) {
      return {
        attributeValues: { some: { attributeDefinitionId } },
      };
    }
    return {
      attributeValues: { none: { attributeDefinitionId } },
    };
  }

  switch (definition.type) {
    case AttributeType.TEXT:
      return textWhere(attributeDefinitionId, filter);
    case AttributeType.NUMBER:
      return numberWhere(attributeDefinitionId, filter);
    case AttributeType.BOOLEAN:
      return booleanWhere(attributeDefinitionId, filter);
    case AttributeType.SINGLE_SELECT:
      return selectWhere(attributeDefinitionId, filter, false);
    case AttributeType.MULTI_SELECT:
      return selectWhere(attributeDefinitionId, filter, true);
    default:
      throw invalidAttributeFilter(`Unsupported attribute type.`);
  }
}

function textWhere(
  attributeDefinitionId: string,
  filter: ParsedAttributeFilter,
): Prisma.ProductWhereInput {
  if (filter.op === 'eq') {
    const needle = filter.rawValue.trim();
    if (!needle) throw invalidAttributeFilter('TEXT eq requires a non-empty value.');
    return {
      attributeValues: {
        some: {
          attributeDefinitionId,
          textValue: { equals: needle, mode: 'insensitive' },
        },
      },
    };
  }
  if (filter.op === 'contains') {
    const needle = filter.rawValue.trim();
    if (!needle) throw invalidAttributeFilter('TEXT contains requires a non-empty value.');
    const folded = normalizeCatalogNameKey(needle);
    return {
      attributeValues: {
        some: {
          attributeDefinitionId,
          OR: [
            { textValue: { contains: needle, mode: 'insensitive' } },
            ...(folded && folded !== needle.toLocaleLowerCase('en-US')
              ? [{ textValue: { contains: folded, mode: 'insensitive' as const } }]
              : []),
          ],
        },
      },
    };
  }
  throw invalidAttributeFilter(`Unsupported TEXT operator "${filter.op}".`);
}

function numberWhere(
  attributeDefinitionId: string,
  filter: ParsedAttributeFilter,
): Prisma.ProductWhereInput {
  const n = Number(filter.rawValue.trim());
  if (!Number.isFinite(n)) {
    throw invalidAttributeFilter(`Invalid number value "${filter.rawValue}".`);
  }
  const decimal = new Prisma.Decimal(n);
  if (filter.op === 'eq') {
    return {
      attributeValues: {
        some: { attributeDefinitionId, numberValue: decimal },
      },
    };
  }
  if (filter.op === 'gte') {
    return {
      attributeValues: {
        some: { attributeDefinitionId, numberValue: { gte: decimal } },
      },
    };
  }
  if (filter.op === 'lte') {
    return {
      attributeValues: {
        some: { attributeDefinitionId, numberValue: { lte: decimal } },
      },
    };
  }
  throw invalidAttributeFilter(`Unsupported NUMBER operator "${filter.op}".`);
}

function booleanWhere(
  attributeDefinitionId: string,
  filter: ParsedAttributeFilter,
): Prisma.ProductWhereInput {
  if (filter.op !== 'eq') {
    throw invalidAttributeFilter(`Unsupported BOOLEAN operator "${filter.op}".`);
  }
  const v = filter.rawValue.trim().toLowerCase();
  if (v !== 'true' && v !== 'false' && v !== '1' && v !== '0') {
    throw invalidAttributeFilter('BOOLEAN eq requires true or false.');
  }
  const bool = v === 'true' || v === '1';
  return {
    attributeValues: {
      some: { attributeDefinitionId, booleanValue: bool },
    },
  };
}

function selectWhere(
  attributeDefinitionId: string,
  filter: ParsedAttributeFilter,
  multi: boolean,
): Prisma.ProductWhereInput {
  const optionIds = filter.rawValue
    .split('|')
    .map((id) => id.trim())
    .filter(Boolean);
  if (optionIds.length === 0) {
    throw invalidAttributeFilter('Select filter requires at least one option id.');
  }
  for (const id of optionIds) {
    if (!UUID_PATTERN.test(id)) {
      throw invalidAttributeFilter(`Invalid option id "${id}".`);
    }
  }

  if (!multi) {
    if (filter.op === 'eq') {
      if (optionIds.length !== 1) {
        throw invalidAttributeFilter('SINGLE_SELECT eq requires exactly one option id.');
      }
      return {
        attributeValues: {
          some: {
            attributeDefinitionId,
            selections: { some: { attributeOptionId: optionIds[0] } },
          },
        },
      };
    }
    if (filter.op === 'in') {
      return {
        attributeValues: {
          some: {
            attributeDefinitionId,
            selections: { some: { attributeOptionId: { in: optionIds } } },
          },
        },
      };
    }
  } else {
    if (filter.op === 'containsAny') {
      return {
        attributeValues: {
          some: {
            attributeDefinitionId,
            selections: { some: { attributeOptionId: { in: optionIds } } },
          },
        },
      };
    }
    if (filter.op === 'containsAll') {
      return {
        AND: optionIds.map((optionId) => ({
          attributeValues: {
            some: {
              attributeDefinitionId,
              selections: { some: { attributeOptionId: optionId } },
            },
          },
        })),
      };
    }
  }

  throw invalidAttributeFilter(
    `Unsupported ${multi ? 'MULTI_SELECT' : 'SINGLE_SELECT'} operator "${filter.op}".`,
  );
}

function parseHasValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw invalidAttributeFilter('hasValue requires true or false.');
}

function invalidAttributeFilter(message: string): AppError {
  return new AppError({
    code: ERROR_CODES.VALIDATION_ERROR,
    message,
    statusCode: 400,
    details: { code: 'INVALID_ATTRIBUTE_FILTER' },
  });
}
