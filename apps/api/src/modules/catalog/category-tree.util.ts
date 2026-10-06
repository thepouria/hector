import { CATEGORY_MAX_DEPTH } from './catalog.constants';

export type CategoryTreeNodeInput = {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  status: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type CategoryTreeNode = CategoryTreeNodeInput & {
  children: CategoryTreeNode[];
};

/**
 * Builds a forest from a flat adjacency list in memory (one company query → tree).
 * Orphans (missing parent) are attached as roots defensively.
 * Cycle-safe via visited set during child attachment.
 */
export function buildCategoryTree(rows: CategoryTreeNodeInput[]): CategoryTreeNode[] {
  const byId = new Map<string, CategoryTreeNode>();
  for (const row of rows) {
    byId.set(row.id, { ...row, children: [] });
  }

  const roots: CategoryTreeNode[] = [];

  for (const node of byId.values()) {
    if (!node.parentId) {
      roots.push(node);
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const sortRecursive = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.name.localeCompare(b.name, 'fa');
    });
    for (const child of nodes) {
      sortRecursive(child.children);
    }
  };
  sortRecursive(roots);
  return roots;
}

/** Returns true if `candidateAncestorId` is the node or an ancestor of `nodeId`. */
export function isAncestorOrSelf(
  rows: Array<{ id: string; parentId: string | null }>,
  nodeId: string,
  candidateAncestorId: string,
): boolean {
  if (nodeId === candidateAncestorId) return true;
  const byId = new Map(rows.map((row) => [row.id, row]));
  let current = byId.get(nodeId);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (seen.has(current.id)) return true; // corrupt cycle
    seen.add(current.id);
    if (current.parentId === candidateAncestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/** Collects all descendant ids of `rootId` (excluding root). Cycle-safe. */
export function collectDescendantIds(
  rows: Array<{ id: string; parentId: string | null }>,
  rootId: string,
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row.id);
    childrenByParent.set(row.parentId, list);
  }

  const result = new Set<string>();
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    const children = childrenByParent.get(id);
    if (children) stack.push(...children);
  }
  return result;
}

/** Depth of a node (root = 1). Returns null if cycle/orphan chain exceeds max. */
export function computeDepth(
  rows: Array<{ id: string; parentId: string | null }>,
  nodeId: string,
  parentIdOverride?: string | null,
): number | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let depth = 1;
  let parentId =
    parentIdOverride !== undefined ? parentIdOverride : (byId.get(nodeId)?.parentId ?? null);
  const seen = new Set<string>([nodeId]);

  while (parentId) {
    depth += 1;
    if (depth > CATEGORY_MAX_DEPTH) return null;
    if (seen.has(parentId)) return null;
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return depth;
}

/** Breadcrumb path names from root → node. */
export function buildCategoryPath(
  rows: Array<{ id: string; parentId: string | null; name: string }>,
  categoryId: string,
  separator = ' / ',
): string {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const names: string[] = [];
  let current = byId.get(categoryId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(separator);
}

/**
 * True when category and every ancestor are ACTIVE.
 * Prevents assigning products under an archived/inactive ancestor branch.
 * Missing category → false. Cycle-safe via visited set.
 */
export function isCategoryAssignable(
  rows: Array<{ id: string; parentId: string | null; status: string }>,
  categoryId: string,
  activeStatus = 'ACTIVE',
): boolean {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let current = byId.get(categoryId);
  if (!current) return false;

  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    if (current.status !== activeStatus) return false;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return true;
}
