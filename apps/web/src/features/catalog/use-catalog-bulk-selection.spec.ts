import { describe, expect, it } from 'vitest';
import {
  buildBulkSelectionPayload,
  type BulkSelectionState,
} from './use-catalog-bulk-selection';

describe('buildBulkSelectionPayload', () => {
  it('returns null for empty selection', () => {
    expect(buildBulkSelectionPayload({ mode: 'none' }, {})).toBeNull();
  });

  it('builds IDS payload', () => {
    const state: BulkSelectionState = { mode: 'ids', ids: new Set(['a', 'b']) };
    expect(buildBulkSelectionPayload(state, { page: 1 })).toEqual({
      mode: 'IDS',
      ids: ['a', 'b'],
    });
  });

  it('builds QUERY payload without pagination/sort and sets selectAll when unfiltered', () => {
    const state: BulkSelectionState = {
      mode: 'query',
      excludedIds: new Set(['x']),
      matchedTotal: 10,
    };
    expect(
      buildBulkSelectionPayload(state, {
        page: 2,
        pageSize: 20,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
    ).toEqual({
      mode: 'QUERY',
      query: {},
      excludedIds: ['x'],
      selectAll: true,
    });
  });

  it('does not set selectAll when query has filters', () => {
    const state: BulkSelectionState = {
      mode: 'query',
      excludedIds: new Set(),
      matchedTotal: 5,
    };
    const payload = buildBulkSelectionPayload(state, { brandId: 'b1', page: 1 });
    expect(payload).toMatchObject({
      mode: 'QUERY',
      query: { brandId: 'b1' },
    });
    expect(payload && 'selectAll' in payload ? payload.selectAll : undefined).toBeUndefined();
  });
});
