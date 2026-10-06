import type {
  AttributeDefinition,
  AttributeScope,
  AttributeType,
  EntityAttributeValue,
  PutEntityAttributeItem,
} from '@/types/catalog';

export function attributeTypeLabel(type: AttributeType | string): string {
  switch (type) {
    case 'TEXT':
      return 'متن';
    case 'NUMBER':
      return 'عدد';
    case 'BOOLEAN':
      return 'بله/خیر';
    case 'SINGLE_SELECT':
      return 'انتخاب تکی';
    case 'MULTI_SELECT':
      return 'انتخاب چندگانه';
    default:
      return type;
  }
}

export function attributeScopeLabel(scope: AttributeScope | string): string {
  switch (scope) {
    case 'PRODUCT':
      return 'محصول';
    case 'SKU':
      return 'SKU';
    case 'BOTH':
      return 'محصول و SKU';
    default:
      return scope;
  }
}

export function scopeMatchesEntity(scope: AttributeScope, entity: 'product' | 'sku'): boolean {
  if (scope === 'BOTH') return true;
  return entity === 'product' ? scope === 'PRODUCT' : scope === 'SKU';
}

export type AttributeDraftValue = {
  attributeId: string;
  definition: AttributeDefinition;
  textValue: string;
  numberValue: string;
  /** `null` = نامشخص (no value stored) */
  booleanValue: boolean | null;
  optionIds: string[];
};

export function emptyDraft(definition: AttributeDefinition): AttributeDraftValue {
  return {
    attributeId: definition.id,
    definition,
    textValue: '',
    numberValue: '',
    booleanValue: null,
    optionIds: [],
  };
}

export function draftFromEntityValue(
  definition: AttributeDefinition,
  value: EntityAttributeValue,
): AttributeDraftValue {
  return {
    attributeId: definition.id,
    definition,
    textValue: value.textValue ?? '',
    numberValue: value.numberValue ?? '',
    booleanValue: value.booleanValue,
    optionIds: value.selectedOptions.map((o) => o.id),
  };
}

export function draftHasStoredValue(draft: AttributeDraftValue): boolean {
  const { type } = draft.definition;
  if (type === 'TEXT') return draft.textValue.trim().length > 0;
  if (type === 'NUMBER') {
    const n = draft.numberValue.trim();
    if (!n) return false;
    return !Number.isNaN(Number(n));
  }
  if (type === 'BOOLEAN') return draft.booleanValue === true || draft.booleanValue === false;
  if (type === 'SINGLE_SELECT' || type === 'MULTI_SELECT') return draft.optionIds.length > 0;
  return false;
}

export function entityValueHasDisplay(value: EntityAttributeValue): boolean {
  const { type } = value.attribute;
  if (type === 'TEXT') return Boolean(value.textValue?.trim());
  if (type === 'NUMBER') return value.numberValue != null && value.numberValue !== '';
  if (type === 'BOOLEAN') return value.booleanValue === true || value.booleanValue === false;
  if (type === 'SINGLE_SELECT' || type === 'MULTI_SELECT') return value.selectedOptions.length > 0;
  return false;
}

export function formatEntityAttributeDisplay(value: EntityAttributeValue): string {
  const { type, unit } = value.attribute;
  if (type === 'TEXT') return value.textValue?.trim() ?? '';
  if (type === 'NUMBER') {
    const raw = value.numberValue ?? '';
    return unit ? `${raw} ${unit}` : raw;
  }
  if (type === 'BOOLEAN') {
    if (value.booleanValue === true) return 'بله';
    if (value.booleanValue === false) return 'خیر';
    return '';
  }
  if (type === 'SINGLE_SELECT' || type === 'MULTI_SELECT') {
    return value.selectedOptions.map((o) => o.value).join('، ');
  }
  return '';
}

export function buildPutPayloadFromDrafts(drafts: AttributeDraftValue[]): PutEntityAttributeItem[] {
  return drafts.filter(draftHasStoredValue).map((draft) => {
    const { type } = draft.definition;
    const item: PutEntityAttributeItem = { attributeId: draft.attributeId };
    if (type === 'TEXT') {
      item.textValue = draft.textValue.trim();
    } else if (type === 'NUMBER') {
      item.numberValue = Number(draft.numberValue.trim());
    } else if (type === 'BOOLEAN') {
      item.booleanValue = draft.booleanValue;
    } else if (type === 'SINGLE_SELECT') {
      item.optionIds = draft.optionIds.slice(0, 1);
    } else if (type === 'MULTI_SELECT') {
      item.optionIds = [...draft.optionIds];
    }
    return item;
  });
}

export function mergeDefinition(
  ref: EntityAttributeValue['attribute'],
  full?: AttributeDefinition,
): AttributeDefinition {
  if (full && full.id === ref.id) return full;
  return {
    id: ref.id,
    companyId: full?.companyId ?? '',
    name: ref.name,
    code: ref.code,
    type: ref.type,
    scope: ref.scope,
    unit: ref.unit,
    description: full?.description ?? null,
    status: ref.status,
    options: full?.options,
    createdAt: full?.createdAt ?? '',
    updatedAt: full?.updatedAt ?? '',
    archivedAt: full?.archivedAt ?? null,
  };
}
