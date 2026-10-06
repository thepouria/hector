'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { CatalogParamReader } from './catalog-list-params';

/** Keeps typing from hammering the list endpoints while staying responsive. */
export const CATALOG_SEARCH_DEBOUNCE_MS = 300;

type CatalogListParamsOptions<T> = {
  /** Must be referentially stable (declare it at module scope). */
  parse: (reader: CatalogParamReader) => T;
  serialize: (params: T) => URLSearchParams;
  defaults: T;
};

/**
 * Keeps list state (search, filters, sorting, pagination) in the URL so views are
 * shareable, survive a reload, and restore on browser back/forward.
 */
export function useCatalogListParams<T extends { page: number }>({
  parse,
  serialize,
  defaults,
}: CatalogListParamsOptions<T>): {
  params: T;
  setParams: (patch: Partial<T>) => void;
  resetParams: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const params = React.useMemo(() => parse(searchParams), [parse, searchParams]);

  const replace = React.useCallback(
    (next: T) => {
      const query = serialize(next).toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, serialize],
  );

  const setParams = React.useCallback(
    (patch: Partial<T>) => {
      // Changing anything but the page itself invalidates the current offset.
      const page = 'page' in patch ? {} : { page: 1 };
      replace({ ...params, ...patch, ...page });
    },
    [params, replace],
  );

  const resetParams = React.useCallback(() => replace(defaults), [defaults, replace]);

  return { params, setParams, resetParams };
}

/**
 * Local input state that commits to the URL after a debounce, and adopts external
 * changes to the committed value (back/forward navigation, "clear all", company switch).
 */
export function useDebouncedSearchInput(
  committed: string,
  commit: (next: string) => void,
  delay: number = CATALOG_SEARCH_DEBOUNCE_MS,
): [string, (next: string) => void] {
  const [input, setInput] = React.useState(committed);
  const lastCommitted = React.useRef(committed);
  const commitRef = React.useRef(commit);

  React.useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  React.useEffect(() => {
    if (committed === lastCommitted.current) return;
    lastCommitted.current = committed;
    setInput(committed);
  }, [committed]);

  React.useEffect(() => {
    const trimmed = input.trim();
    if (trimmed === committed) return;
    const timer = window.setTimeout(() => {
      lastCommitted.current = trimmed;
      commitRef.current(trimmed);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [committed, delay, input]);

  return [input, setInput];
}
