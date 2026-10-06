'use client';

import * as React from 'react';
import { groupPermissions } from '@/lib/permissions/presentation';
import { cn } from '@/lib/utils/cn';

export type PermissionOption = {
  id: string;
  key: string;
  description?: string | null;
};

type PermissionSelectorProps = {
  catalog: PermissionOption[];
  value: string[];
  onChange: (nextIds: string[]) => void;
  /** Permission keys the current user may grant. Missing keys are disabled. */
  grantableKeys?: Set<string> | string[];
  disabled?: boolean;
  className?: string;
};

export function PermissionSelector({
  catalog,
  value,
  onChange,
  grantableKeys,
  disabled = false,
  className,
}: PermissionSelectorProps) {
  const grantable =
    grantableKeys instanceof Set
      ? grantableKeys
      : grantableKeys
        ? new Set(grantableKeys)
        : null;

  const groups = React.useMemo(() => groupPermissions(catalog), [catalog]);
  const selectedCount = value.length;

  function toggleOne(id: string, checked: boolean) {
    if (disabled) return;
    onChange(checked ? [...value, id] : value.filter((item) => item !== id));
  }

  function toggleGroup(ids: string[], checked: boolean) {
    if (disabled) return;
    if (checked) {
      const next = new Set(value);
      for (const id of ids) next.add(id);
      onChange([...next]);
      return;
    }
    const remove = new Set(ids);
    onChange(value.filter((id) => !remove.has(id)));
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>{selectedCount} دسترسی انتخاب شده</span>
      </div>
      <div className="max-h-[28rem] space-y-4 overflow-y-auto rounded-md border border-slate-200 p-3">
        {groups.map((group) => {
          const groupIds = group.items
            .filter((item) => !grantable || grantable.has(item.key))
            .map((item) => item.id);
          const selectedInGroup = groupIds.filter((id) => value.includes(id)).length;
          const allChecked = groupIds.length > 0 && selectedInGroup === groupIds.length;
          const someChecked = selectedInGroup > 0 && !allChecked;

          return (
            <PermissionGroupBlock
              key={group.group}
              label={group.label}
              allChecked={allChecked}
              someChecked={someChecked}
              disabled={disabled || groupIds.length === 0}
              onToggleGroup={(checked) => toggleGroup(groupIds, checked)}
              items={group.items}
              value={value}
              grantable={grantable}
              disabledAll={disabled}
              onToggleOne={toggleOne}
            />
          );
        })}
      </div>
    </div>
  );
}

function PermissionGroupBlock({
  label,
  allChecked,
  someChecked,
  disabled,
  onToggleGroup,
  items,
  value,
  grantable,
  disabledAll,
  onToggleOne,
}: {
  label: string;
  allChecked: boolean;
  someChecked: boolean;
  disabled: boolean;
  onToggleGroup: (checked: boolean) => void;
  items: Array<{
    id: string;
    key: string;
    presentation: { label: string; description: string };
  }>;
  value: string[];
  grantable: Set<string> | null;
  disabledAll: boolean;
  onToggleOne: (id: string, checked: boolean) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = someChecked;
    }
  }, [someChecked]);

  return (
    <fieldset className="space-y-2">
      <legend className="flex w-full items-center gap-2 text-sm font-semibold text-slate-800">
        <input
          ref={ref}
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300"
          checked={allChecked}
          disabled={disabled}
          onChange={(event) => onToggleGroup(event.target.checked)}
          aria-label={`انتخاب همه دسترسی‌های ${label}`}
        />
        <span>{label}</span>
      </legend>
      <div className="space-y-2 ps-6">
        {items.map((item) => {
          const canGrant = !grantable || grantable.has(item.key);
          const checked = value.includes(item.id);
          return (
            <label
              key={item.id}
              className={cn('flex items-start gap-2 text-sm', !canGrant && 'opacity-60')}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                checked={checked}
                disabled={disabledAll || !canGrant}
                onChange={(event) => onToggleOne(item.id, event.target.checked)}
                aria-describedby={!canGrant ? `${item.id}-hint` : undefined}
              />
              <span>
                <span className="font-medium text-slate-800">{item.presentation.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {item.presentation.description}
                </span>
                <span className="mt-0.5 block font-mono text-[11px] text-slate-400" dir="ltr">
                  {item.key}
                </span>
                {!canGrant ? (
                  <span id={`${item.id}-hint`} className="mt-1 block text-xs text-amber-700">
                    شما اجازه واگذاری این دسترسی را ندارید.
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
