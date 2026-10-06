'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchSupplierOptions } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { supplierKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { useSession } from '@/providers/app-providers';
import type { SupplierOption } from '@/types/purchasing';

const DEBOUNCE_MS = 300;

export function SupplierPicker({
  id = 'supplier-picker',
  label = 'تأمین‌کننده',
  value,
  onChange,
  disabled,
}: {
  id?: string;
  label?: string;
  value: SupplierOption | null;
  onChange: (next: SupplierOption | null) => void;
  disabled?: boolean;
}) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const [term, setTerm] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const optionsQuery = useQuery({
    queryKey: supplierKeys.list(companyId, {
      view: 'options',
      search: debounced || undefined,
      page: 1,
      pageSize: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    }),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ) && open && !disabled,
    queryFn: () =>
      fetchSupplierOptions(companyId, {
        search: debounced || undefined,
        page: 1,
        pageSize: 20,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
  });

  const options = optionsQuery.data?.data ?? [];
  const showPanel = open && !value;

  return (
    <div className="space-y-1" ref={rootRef}>
      <Label htmlFor={id}>{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-slate-900">{value.name}</span>
            {value.code ? (
              <span className="block text-xs text-slate-500" dir="ltr">
                {value.code}
              </span>
            ) : null}
          </span>
          {value.status === 'INACTIVE' ? (
            <Badge className="text-[10px]">غیرفعال</Badge>
          ) : null}
          {!disabled ? (
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-slate-600 hover:text-slate-900"
              onClick={() => onChange(null)}
            >
              تغییر
            </button>
          ) : null}
        </div>
      ) : (
        <div className="relative">
          <Search
            className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <Input
            id={id}
            className="pe-9"
            disabled={disabled}
            placeholder="نام یا کد تأمین‌کننده..."
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          {showPanel ? (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
              {optionsQuery.isPending ? (
                <p className="px-3 py-2 text-sm text-slate-500">در حال جستجو...</p>
              ) : null}
              {optionsQuery.isError ? (
                <p className="px-3 py-2 text-sm text-red-700">
                  {mapBusinessError(optionsQuery.error)}
                </p>
              ) : null}
              {!optionsQuery.isPending && options.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">تأمین‌کننده‌ای پیدا نشد.</p>
              ) : null}
              {options.length > 0 ? (
                <ul className="max-h-60 overflow-y-auto">
                  {options.map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-slate-50',
                        )}
                        onClick={() => {
                          onChange(option);
                          setTerm('');
                          setOpen(false);
                        }}
                      >
                        <span>
                          <span className="block font-medium text-slate-900">{option.name}</span>
                          {option.code ? (
                            <span className="block text-xs text-slate-500" dir="ltr">
                              {option.code}
                            </span>
                          ) : null}
                        </span>
                        {option.status === 'INACTIVE' ? (
                          <Badge className="text-[10px]">غیرفعال</Badge>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
