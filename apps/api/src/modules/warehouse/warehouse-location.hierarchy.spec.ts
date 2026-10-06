import {
  buildBreadcrumb,
  buildLocationTree,
  collectDescendantIds,
  wouldCreateCycle,
} from './warehouse-location.hierarchy';

describe('warehouse-location.hierarchy', () => {
  const byId = new Map([
    ['a', { id: 'a', parentId: null as string | null }],
    ['b', { id: 'b', parentId: 'a' }],
    ['c', { id: 'c', parentId: 'b' }],
    ['d', { id: 'd', parentId: null as string | null }],
  ]);

  it('detects cycles when moving an ancestor under a descendant', () => {
    expect(wouldCreateCycle(byId, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(byId, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(byId, 'a', 'd')).toBe(false);
    expect(wouldCreateCycle(byId, 'c', 'd')).toBe(false);
  });

  it('collects descendants', () => {
    expect([...collectDescendantIds(byId, 'a')].sort()).toEqual(['b', 'c']);
    expect([...collectDescendantIds(byId, 'c')]).toEqual([]);
  });

  it('builds a sorted tree from flat adjacency rows', () => {
    const tree = buildLocationTree([
      {
        id: 'a',
        parentId: null,
        type: 'ZONE' as never,
        code: 'Z2',
        name: null,
        barcode: 'LOC-A',
        status: 'ACTIVE',
        sortOrder: 2,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'b',
        parentId: 'a',
        type: 'SHELF' as never,
        code: 'S01',
        name: null,
        barcode: 'LOC-B',
        status: 'ACTIVE',
        sortOrder: 1,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'c',
        parentId: null,
        type: 'SHELF' as never,
        code: 'S00',
        name: null,
        barcode: 'LOC-C',
        status: 'ACTIVE',
        sortOrder: 1,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    expect(tree.map((n) => n.code)).toEqual(['S00', 'Z2']);
    expect(tree[1]!.children.map((n) => n.code)).toEqual(['S01']);
  });

  it('builds breadcrumbs from parentId chain', () => {
    const nodes = new Map([
      ['a', { id: 'a', parentId: null as string | null, code: 'ZONE-A', name: 'Zone A' }],
      ['b', { id: 'b', parentId: 'a', code: 'R01', name: null }],
      ['c', { id: 'c', parentId: 'b', code: 'S01', name: 'Shelf' }],
    ]);
    expect(buildBreadcrumb(nodes, 'c').map((x) => x.code)).toEqual(['ZONE-A', 'R01', 'S01']);
  });
});
