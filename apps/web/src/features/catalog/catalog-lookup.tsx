'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
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
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { CatalogLookupHit } from '@/types/catalog';
import {
  CATALOG_LOOKUP_MIN_LENGTH,
  catalogLookupHref,
  catalogLookupTypeLabel,
  isLtrLookupLabel,
  isLtrLookupSublabel,
} from './catalog-lookup-utils';
import { CATALOG_SEARCH_DEBOUNCE_MS } from './use-catalog-list-params';
import Link from 'next/link';

const LOOKUP_LIMIT = 10;

function statusNote(hit: CatalogLookupHit): string | null {
  if (hit.status === 'INACTIVE') return 'غیرفعال';
  if (hit.status === 'ARCHIVED') return 'بایگانی';
  return null;
}

/**
 * Typeahead over products, SKUs and barcodes (GET /catalog/lookup). Read-only: selecting a
 * hit only navigates. For operational scanning use the barcode resolve endpoint instead.
 */
export function CatalogLookup({
  id = 'catalog-lookup',
  label = 'جستجوی سریع کاتالوگ',
  placeholder = 'نام محصول، کد SKU یا بارکد...',
  className,
}: {
  id?: string;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.CATALOG_READ);

  const [term, setTerm] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const trimmed = term.trim();
    if (trimmed === debounced) return;
    const timer = window.setTimeout(() => setDebounced(trimmed), CATALOG_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [debounced, term]);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const enabled =
    Boolean(companyId) && canRead && debounced.length >= CATALOG_LOOKUP_MIN_LENGTH;

  const lookupQuery = useQuery({
    queryKey: catalogKeys.lookup(companyId, debounced, LOOKUP_LIMIT),
    enabled,
    queryFn: () => fetchCatalogLookup(companyId, debounced, LOOKUP_LIMIT),
  });

  const hits = enabled ? (lookupQuery.data ?? []) : [];

  React.useEffect(() => {
    setHighlight(0);
  }, [debounced]);

  if (!canRead) return null;

  const select = (hit: CatalogLookupHit) => {
    const href = catalogLookupHref(hit);
    if (!href) return;
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => {
        const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
        return (next + hits.length) % hits.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      const hit = hits[highlight];
      if (!hit) return;
      event.preventDefault();
      select(hit);
    }
  };

  const showPanel = open && debounced.length >= CATALOG_LOOKUP_MIN_LENGTH;
  const activeId = showPanel && hits[highlight] ? `${id}-option-${highlight}` : undefined;

  return (
    <div className={cn('relative', className)} ref={rootRef}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative mt-1">
        <Search
          className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <Input
          id={id}
          className="pe-9"
          value={term}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      {showPanel ? (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {lookupQuery.isPending ? (
            <p className="px-3 py-2 text-sm text-slate-500">در حال جستجو...</p>
          ) : null}
          {lookupQuery.isError ? (
            <p className="px-3 py-2 text-sm text-red-700">{mapBusinessError(lookupQuery.error)}</p>
          ) : null}
          {!lookupQuery.isPending && !lookupQuery.isError && hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">نتیجه‌ای پیدا نشد.</p>
          ) : null}
          {hits.length > 0 ? (
            <ul id={`${id}-listbox`} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
              {hits.map((hit, index) => {
                const note = statusNote(hit);
                const ltr = isLtrLookupLabel(hit.type);
                return (
                  <li key={`${hit.type}-${hit.id}`}>
                    <button
                      type="button"
                      id={`${id}-option-${index}`}
                      role="option"
                      aria-selected={index === highlight}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-start text-sm',
                        index === highlight ? 'bg-slate-100' : 'hover:bg-slate-50',
                      )}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => select(hit)}
                    >
                      <span className="min-w-0">
                        <span
                          className={cn(
                            'block truncate font-medium text-slate-900',
                            ltr && 'font-mono',
                          )}
                          dir={ltr ? 'ltr' : undefined}
                        >
                          {hit.label}
                        </span>
                        {hit.sublabel ? (
                          <span
                            className={cn(
                              'block truncate text-xs text-slate-500',
                              isLtrLookupSublabel(hit.type) && 'font-mono',
                            )}
                            dir={isLtrLookupSublabel(hit.type) ? 'ltr' : undefined}
                          >
                            {hit.sublabel}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {note ? <Badge className="text-[10px]">{note}</Badge> : null}
                        <Badge className="text-[10px]">{catalogLookupTypeLabel(hit.type)}</Badge>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {debounced.length >= CATALOG_LOOKUP_MIN_LENGTH ? (
            <div className="border-t border-slate-100 px-3 py-2">
              <Link
                href={`${ROUTES.catalogProducts}?q=${encodeURIComponent(debounced)}`}
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
                onClick={() => setOpen(false)}
              >
                مشاهده همه نتایج در محصولات
              </Link>
              <span className="mx-2 text-slate-300">·</span>
              <Link
                href={`${ROUTES.catalogSkus}?q=${encodeURIComponent(debounced)}`}
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
                onClick={() => setOpen(false)}
              >
                SKUها
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
