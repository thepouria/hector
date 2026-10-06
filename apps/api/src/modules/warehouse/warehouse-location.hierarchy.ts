import type { WarehouseLocationType } from '@hector/database';
import { LOCATION_TRAVERSAL_MAX_DEPTH } from './warehouse-location.constants';

export type LocationNode = {
  id: string;
  parentId: string | null;
  type: WarehouseLocationType;
  code: string;
  name: string | null;
  barcode: string;
  status: string;
  sortOrder: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Walk ancestors of `startId` (excluding start). Bounded against pathological graphs.
 */
export function collectAncestorIds(
  byId: Map<string, { id: string; parentId: string | null }>,
  startId: string,
): string[] {
  const ancestors: string[] = [];
  let current = byId.get(startId)?.parentId ?? null;
  let depth = 0;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current) || depth >= LOCATION_TRAVERSAL_MAX_DEPTH) {
      break;
    }
    seen.add(current);
    ancestors.push(current);
    current = byId.get(current)?.parentId ?? null;
    depth += 1;
  }
  return ancestors;
}

/** True if `candidateParentId` is the node itself or a descendant of `nodeId`. */
export function wouldCreateCycle(
  byId: Map<string, { id: string; parentId: string | null }>,
  nodeId: string,
  candidateParentId: string,
): boolean {
  if (candidateParentId === nodeId) {
    return true;
  }
  const descendants = collectDescendantIds(byId, nodeId);
  return descendants.has(candidateParentId);
}

export function collectDescendantIds(
  byId: Map<string, { id: string; parentId: string | null }>,
  rootId: string,
): Set<string> {
  const childrenByParent = new Map<string | null, string[]>();
  for (const node of byId.values()) {
    const list = childrenByParent.get(node.parentId) ?? [];
    list.push(node.id);
    childrenByParent.set(node.parentId, list);
  }

  const result = new Set<string>();
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  let steps = 0;
  while (stack.length > 0 && steps < byId.size + LOCATION_TRAVERSAL_MAX_DEPTH) {
    const id = stack.pop()!;
    if (result.has(id)) {
      continue;
    }
    result.add(id);
    for (const child of childrenByParent.get(id) ?? []) {
      stack.push(child);
    }
    steps += 1;
  }
  return result;
}

export function buildLocationTree<T extends LocationNode>(
  rows: T[],
): Array<T & { children: Array<T & { children: unknown[] }> }> {
  type TreeNode = T & { children: TreeNode[] };
  const nodes = new Map<string, TreeNode>();
  for (const row of rows) {
    nodes.set(row.id, { ...row, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (list: TreeNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    for (const child of list) {
      sortNodes(child.children);
    }
  };
  sortNodes(roots);
  return roots;
}

export function buildBreadcrumb(
  byId: Map<string, { id: string; parentId: string | null; code: string; name: string | null }>,
  locationId: string,
): Array<{ id: string; code: string; name: string | null }> {
  const chain: Array<{ id: string; code: string; name: string | null }> = [];
  let current: string | null = locationId;
  let depth = 0;
  const seen = new Set<string>();
  while (current && depth < LOCATION_TRAVERSAL_MAX_DEPTH) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const node = byId.get(current);
    if (!node) {
      break;
    }
    chain.push({ id: node.id, code: node.code, name: node.name });
    current = node.parentId;
    depth += 1;
  }
  return chain.reverse();
}
