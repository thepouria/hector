'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils/cn';
import type { AttributeDraftValue } from '@/features/catalog/attribute-utils';

const selectClassName =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

type AttributeValueFieldsProps = {
  draft: AttributeDraftValue;
  onChange: (next: AttributeDraftValue) => void;
  idPrefix?: string;
};

export function AttributeValueFields({ draft, onChange, idPrefix = 'attr' }: AttributeValueFieldsProps) {
  const { definition } = draft;
  const fieldId = `${idPrefix}-${definition.id}`;

  if (definition.type === 'TEXT') {
    return (
      <Input
        id={fieldId}
        value={draft.textValue}
        onChange={(event) => onChange({ ...draft, textValue: event.target.value })}
        maxLength={2000}
      />
    );
  }

  if (definition.type === 'NUMBER') {
    return (
      <div className="flex items-center gap-2">
        <Input
          id={fieldId}
          dir="ltr"
          type="text"
          inputMode="decimal"
          className="flex-1"
          value={draft.numberValue}
          onChange={(event) => onChange({ ...draft, numberValue: event.target.value })}
        />
        {definition.unit ? (
          <span className="shrink-0 text-sm text-slate-500" dir="ltr">
            {definition.unit}
          </span>
        ) : null}
      </div>
    );
  }

  if (definition.type === 'BOOLEAN') {
    return (
      <select
        id={fieldId}
        className={selectClassName}
        value={
          draft.booleanValue === null ? '' : draft.booleanValue ? 'true' : 'false'
        }
        onChange={(event) => {
          const v = event.target.value;
          onChange({
            ...draft,
            booleanValue: v === '' ? null : v === 'true',
          });
        }}
      >
        <option value="">نامشخص</option>
        <option value="true">بله</option>
        <option value="false">خیر</option>
      </select>
    );
  }

  if (definition.type === 'SINGLE_SELECT') {
    const options = (definition.options ?? []).filter((o) => o.isActive);
    return (
      <select
        id={fieldId}
        className={selectClassName}
        value={draft.optionIds[0] ?? ''}
        onChange={(event) => {
          const id = event.target.value;
          onChange({ ...draft, optionIds: id ? [id] : [] });
        }}
      >
        <option value="">—</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.value}
          </option>
        ))}
      </select>
    );
  }

  if (definition.type === 'MULTI_SELECT') {
    const options = (definition.options ?? []).filter((o) => o.isActive);
    const selected = new Set(draft.optionIds);
    return (
      <div className="flex flex-wrap gap-2" id={fieldId}>
        {options.length === 0 ? (
          <span className="text-sm text-slate-500">گزینه‌ای تعریف نشده است.</span>
        ) : (
          options.map((option) => {
            const active = selected.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                )}
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(option.id)) next.delete(option.id);
                  else next.add(option.id);
                  onChange({ ...draft, optionIds: [...next] });
                }}
              >
                {option.value}
              </button>
            );
          })
        )}
      </div>
    );
  }

  return null;
}

export function AttributeFieldRow({
  draft,
  onChange,
  onRemove,
  idPrefix,
}: {
  draft: AttributeDraftValue;
  onChange: (next: AttributeDraftValue) => void;
  onRemove?: () => void;
  idPrefix?: string;
}) {
  return (
    <div className="space-y-1 rounded-md border border-slate-100 bg-slate-50/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <Label htmlFor={`${idPrefix ?? 'attr'}-${draft.definition.id}`} className="text-slate-800">
          {draft.definition.name}
          {draft.definition.unit && draft.definition.type !== 'NUMBER' ? (
            <span className="ms-1 text-xs font-normal text-slate-500" dir="ltr">
              ({draft.definition.unit})
            </span>
          ) : null}
        </Label>
        {onRemove ? (
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-slate-800"
            onClick={onRemove}
          >
            حذف
          </button>
        ) : null}
      </div>
      <AttributeValueFields draft={draft} onChange={onChange} idPrefix={idPrefix} />
    </div>
  );
}
