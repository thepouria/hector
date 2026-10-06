'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CATALOG_PAGE_SIZES } from './catalog-list-params';

export type FilterChip = {
  key: string;
  label: string;
  onRemove: () => void;
};

/** Shows what is currently narrowing a list, with per-chip and bulk clearing. */
export function FilterChips({
  chips,
  onClearAll,
}: {
  chips: FilterChip[];
  onClearAll: () => void;
}) {
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-slate-500">فیلترهای فعال:</span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pe-1 ps-2 text-xs text-slate-700"
        >
          {chip.label}
          <button
            type="button"
            aria-label={`حذف فیلتر ${chip.label}`}
            className="rounded-full p-0.5 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
            onClick={chip.onRemove}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
        پاک کردن همه
      </Button>
    </div>
  );
}

/** Backend pagination controls; the list never slices rows client-side. */
export function ListPagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <div className="flex items-center gap-2">
        <span>{total} ردیف</span>
        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-500">تعداد در صفحه</span>
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {CATALOG_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          قبلی
        </Button>
        <span>
          صفحه {page} از {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          بعدی
        </Button>
      </div>
    </div>
  );
}
