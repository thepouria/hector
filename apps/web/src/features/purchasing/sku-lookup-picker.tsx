'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchCatalogLookup } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { catalogKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { useSession } from '@/providers/app-providers';
import type { CatalogLookupHit } from '@/types/catalog';
import {
  CATALOG_LOOKUP_MIN_LENGTH,
  catalogLookupTypeLabel,
  isLtrLookupLabel,
  isLtrLookupSublabel,
} from '@/features/catalog/catalog-lookup-utils';
import { CATALOG_SEARCH_DEBOUNCE_MS } from '@/features/catalog/use-catalog-list-params';

const LOOKUP_LIMIT = 10;

export type SkuPickerSelection = {
  skuId: string;
  code: string;
  label: string;
  productName: string;
};

function hitToSkuSelection(hit: CatalogLookupHit): SkuPickerSelection | null {
  if (hit.type === 'SKU' && hit.skuId) {
    return {
      skuId: hit.skuId,
      code: hit.label,
      label: hit.sublabel ? `${hit.label} — ${hit.sublabel}` : hit.label,
      productName: hit.sublabel ?? hit.label,
    };
  }
  if (hit.type === 'BARCODE' && hit.skuId) {
    return {
      skuId: hit.skuId,
      code: hit.sublabel ?? hit.label,
      label: hit.label,
      productName: hit.sublabel ?? '',
    };
  }
  return null;
}

export function SkuLookupPicker({
  id = 'sku-picker',
  label = 'SKU',
  value,
  onChange,
  disabled,
}: {
  id?: string;
  label?: string;
  value: SkuPickerSelection | null;
  onChange: (next: SkuPickerSelection | null) => void;
  disabled?: boolean;
}) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.CATALOG_READ);

  const [term, setTerm] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), CATALOG_SEARCH_DEBOUNCE_MS);
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

  const enabled =
    Boolean(companyId) && canRead && debounced.length >= CATALOG_LOOKUP_MIN_LENGTH && !disabled;

  const lookupQuery = useQuery({
    queryKey: catalogKeys.lookup(companyId, debounced, LOOKUP_LIMIT),
    enabled,
    queryFn: () => fetchCatalogLookup(companyId, debounced, LOOKUP_LIMIT),
  });

  const hits = (enabled ? (lookupQuery.data ?? []) : []).filter(
    (hit) => hit.type === 'SKU' || hit.type === 'BARCODE',
  );

  React.useEffect(() => setHighlight(0), [debounced]);

  const selectHit = (hit: CatalogLookupHit) => {
    const selection = hitToSkuSelection(hit);
    if (!selection) return;
    onChange(selection);
    setTerm('');
    setOpen(false);
  };

  const showPanel = open && debounced.length >= CATALOG_LOOKUP_MIN_LENGTH;

  if (!canRead) {
    return (
      <p className="text-sm text-slate-500">برای انتخاب SKU به دسترسی کاتالوگ نیاز است.</p>
    );
  }

  return (
    <div className="space-y-1" ref={rootRef}>
      <Label htmlFor={id}>{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-slate-900" dir="ltr">
              {value.code}
            </span>
            <span className="block truncate text-xs text-slate-500">{value.productName}</span>
          </span>
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
            placeholder="کد SKU، نام یا بارکد..."
            value={term}
            autoComplete="off"
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false);
                return;
              }
              if (event.key === 'Enter' && hits[highlight]) {
                event.preventDefault();
                selectHit(hits[highlight]);
              }
            }}
          />
          {showPanel ? (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
              {lookupQuery.isPending ? (
                <p className="px-3 py-2 text-sm text-slate-500">در حال جستجو...</p>
              ) : null}
              {lookupQuery.isError ? (
                <p className="px-3 py-2 text-sm text-red-700">
                  {mapBusinessError(lookupQuery.error)}
                </p>
              ) : null}
              {!lookupQuery.isPending && hits.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">SKUای پیدا نشد.</p>
              ) : null}
              {hits.length > 0 ? (
                <ul className="max-h-60 overflow-y-auto">
                  {hits.map((hit, index) => (
                    <li key={`${hit.type}-${hit.id}`}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm',
                          index === highlight ? 'bg-slate-100' : 'hover:bg-slate-50',
                        )}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => selectHit(hit)}
                      >
                        <span className="min-w-0">
                          <span
                            className={cn(
                              'block truncate font-medium',
                              isLtrLookupLabel(hit.type) && 'font-mono',
                            )}
                            dir={isLtrLookupLabel(hit.type) ? 'ltr' : undefined}
                          >
                            {hit.label}
                          </span>
                          {hit.sublabel ? (
                            <span
                              className="block truncate text-xs text-slate-500"
                              dir={isLtrLookupSublabel(hit.type) ? 'ltr' : undefined}
                            >
                              {hit.sublabel}
                            </span>
                          ) : null}
                        </span>
                        <Badge className="text-[10px]">{catalogLookupTypeLabel(hit.type)}</Badge>
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
