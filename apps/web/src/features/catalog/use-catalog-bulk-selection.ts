'use client';

import * as React from 'react';

export type BulkSelectionState =
  | { mode: 'none' }
  | { mode: 'ids'; ids: Set<string> }
  | { mode: 'query'; excludedIds: Set<string>; matchedTotal: number };

export function useCatalogBulkSelection() {
  const [state, setState] = React.useState<BulkSelectionState>({ mode: 'none' });

  const clear = React.useCallback(() => setState({ mode: 'none' }), []);

  const selectedCount = React.useMemo(() => {
    if (state.mode === 'none') return 0;
    if (state.mode === 'ids') return state.ids.size;
    return Math.max(0, state.matchedTotal - state.excludedIds.size);
  }, [state]);

  const isSelected = React.useCallback(
    (id: string) => {
      if (state.mode === 'none') return false;
      if (state.mode === 'ids') return state.ids.has(id);
      return !state.excludedIds.has(id);
    },
    [state],
  );

  const getPageChecked = React.useCallback(
    (pageIds: string[]): 'none' | 'some' | 'all' => {
      if (pageIds.length === 0) return 'none';
      const selected = pageIds.filter((id) => isSelected(id)).length;
      if (selected === 0) return 'none';
      if (selected === pageIds.length) return 'all';
      return 'some';
    },
    [isSelected],
  );

  const toggleId = React.useCallback((id: string) => {
    setState((prev) => {
      if (prev.mode === 'query') {
        const next = new Set(prev.excludedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (next.size >= prev.matchedTotal) return { mode: 'none' };
        return { ...prev, excludedIds: next };
      }
      const ids = new Set(prev.mode === 'ids' ? prev.ids : []);
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      if (ids.size === 0) return { mode: 'none' };
      return { mode: 'ids', ids };
    });
  }, []);

  const togglePage = React.useCallback((pageIds: string[]) => {
    setState((prev) => {
      if (prev.mode === 'query') {
        const allSelected = pageIds.every((id) => !prev.excludedIds.has(id));
        const next = new Set(prev.excludedIds);
        if (allSelected) {
          for (const id of pageIds) next.add(id);
        } else {
          for (const id of pageIds) next.delete(id);
        }
        if (next.size >= prev.matchedTotal) return { mode: 'none' };
        return { ...prev, excludedIds: next };
      }
      const ids = new Set(prev.mode === 'ids' ? prev.ids : []);
      const allSelected = pageIds.length > 0 && pageIds.every((id) => ids.has(id));
      if (allSelected) {
        for (const id of pageIds) ids.delete(id);
      } else {
        for (const id of pageIds) ids.add(id);
      }
      if (ids.size === 0) return { mode: 'none' };
      return { mode: 'ids', ids };
    });
  }, []);

  const selectAllMatching = React.useCallback((matchedTotal: number) => {
    if (matchedTotal <= 0) {
      setState({ mode: 'none' });
      return;
    }
    setState({ mode: 'query', excludedIds: new Set(), matchedTotal });
  }, []);

  return {
    state,
    selectedCount,
    isSelected,
    getPageChecked,
    toggleId,
    togglePage,
    selectAllMatching,
    clear,
  };
}

export function buildBulkSelectionPayload(
  state: BulkSelectionState,
  listQuery: Record<string, string | number | boolean | undefined>,
):
  | { mode: 'IDS'; ids: string[] }
  | {
      mode: 'QUERY';
      query: Record<string, string | number | boolean | undefined>;
      excludedIds?: string[];
      selectAll?: boolean;
    }
  | null {
  if (state.mode === 'none') return null;
  if (state.mode === 'ids') {
    return { mode: 'IDS', ids: [...state.ids] };
  }

  const query: Record<string, string | number | boolean | undefined> = { ...listQuery };
  delete query.page;
  delete query.pageSize;
  delete query.sortBy;
  delete query.sortOrder;

  const hasFilter = Object.entries(query).some(
    ([, value]) => value !== undefined && value !== '' && value !== null,
  );

  return {
    mode: 'QUERY',
    query,
    excludedIds: state.excludedIds.size > 0 ? [...state.excludedIds] : undefined,
    selectAll: hasFilter ? undefined : true,
  };
}
