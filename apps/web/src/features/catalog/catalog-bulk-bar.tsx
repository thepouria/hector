'use client';

import { Button } from '@/components/ui/button';

export type CatalogBulkBarProps = {
  count: number;
  entityLabel: string;
  pageSize: number;
  matchedTotal: number;
  isQueryMode: boolean;
  onSelectAllMatching: () => void;
  onClear: () => void;
  actions: Array<{
    label: string;
    onClick: () => void;
    danger?: boolean;
    disabled?: boolean;
  }>;
};

export function CatalogBulkBar({
  count,
  entityLabel,
  pageSize,
  matchedTotal,
  isQueryMode,
  onSelectAllMatching,
  onClear,
  actions,
}: CatalogBulkBarProps) {
  if (count <= 0) return null;

  return (
    <div
      className="sticky bottom-4 z-20 mx-auto flex max-w-4xl flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
      role="region"
      aria-label="عملیات گروهی"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-800">
        <span>
          {count.toLocaleString('fa-IR')} {entityLabel} انتخاب شده
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          لغو انتخاب
        </Button>
      </div>

      {!isQueryMode && matchedTotal > pageSize && count >= pageSize ? (
        <p className="text-xs text-slate-600">
          {pageSize.toLocaleString('fa-IR')} مورد این صفحه انتخاب شد.{' '}
          <button
            type="button"
            className="font-medium text-slate-900 underline"
            onClick={onSelectAllMatching}
          >
            انتخاب همه {matchedTotal.toLocaleString('fa-IR')} مورد مطابق فیلتر
          </button>
        </p>
      ) : null}

      {isQueryMode ? (
        <p className="text-xs text-slate-600">
          همه {matchedTotal.toLocaleString('fa-IR')} مورد مطابق فیلتر انتخاب شده‌اند (به‌جز موارد لغو‌شده).
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            type="button"
            size="sm"
            variant={action.danger ? 'danger' : 'outline'}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
