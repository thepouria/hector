'use client';

import * as React from 'react';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import {
  activateCategory,
  archiveCategory,
  createCategory,
  fetchCategories,
  fetchCategoryTree,
  moveCategory,
  updateCategory,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { categoryKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import { CategoryAttributesDialog } from '@/features/catalog/category-attributes-dialog';
import type { Category, CategoryTreeNode } from '@/types/catalog';

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

function flattenTree(
  nodes: CategoryTreeNode[],
  path: string[] = [],
): Array<CategoryTreeNode & { path: string; depth: number }> {
  const result: Array<CategoryTreeNode & { path: string; depth: number }> = [];
  for (const node of nodes) {
    const nextPath = [...path, node.name];
    result.push({
      ...node,
      path: nextPath.join(' / '),
      depth: path.length,
    });
    result.push(...flattenTree(node.children, nextPath));
  }
  return result;
}

function collectDescendantIds(node: CategoryTreeNode): Set<string> {
  const ids = new Set<string>();
  const walk = (current: CategoryTreeNode) => {
    for (const child of current.children) {
      ids.add(child.id);
      walk(child);
    }
  };
  walk(node);
  return ids;
}

function findNode(
  nodes: CategoryTreeNode[],
  id: string,
): CategoryTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}

export function CategoriesPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CategoryTreeNode | null>(null);
  const [parentForCreate, setParentForCreate] = React.useState<string | null>(null);
  const [moving, setMoving] = React.useState<CategoryTreeNode | null>(null);
  const [moveParentId, setMoveParentId] = React.useState<string>('');
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [sortOrder, setSortOrder] = React.useState('0');
  const [confirm, setConfirm] = React.useState<
    { type: 'archive' | 'activate'; category: CategoryTreeNode } | null
  >(null);
  const [attributesFor, setAttributesFor] = React.useState<CategoryTreeNode | null>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const treeQuery = useQuery({
    queryKey: categoryKeys.tree(companyId),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ) && !search,
    queryFn: () => fetchCategoryTree(companyId),
  });

  const searchQuery = useQuery({
    queryKey: categoryKeys.list(companyId, { search, page: 1, pageSize: 50 }),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ) && Boolean(search),
    queryFn: () => fetchCategories(companyId, { search, page: 1, pageSize: 50 }),
  });

  React.useEffect(() => {
    const error = treeQuery.error || searchQuery.error;
    if (error && isApiClientError(error) && error.status === 401) {
      handleUnauthorized();
    }
  }, [treeQuery.error, searchQuery.error, handleUnauthorized]);

  React.useEffect(() => {
    if (!treeQuery.data) return;
    // Expand first two levels by default.
    const next = new Set<string>();
    for (const root of treeQuery.data) {
      next.add(root.id);
      for (const child of root.children) next.add(child.id);
    }
    setExpanded(next);
  }, [treeQuery.data]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: categoryKeys.all(companyId) });
  };

  const openCreateRoot = () => {
    setEditing(null);
    setParentForCreate(null);
    setName('');
    setCode('');
    setSortOrder('0');
    setFormOpen(true);
  };

  const openCreateChild = (parent: CategoryTreeNode) => {
    setEditing(null);
    setParentForCreate(parent.id);
    setName('');
    setCode('');
    setSortOrder('0');
    setFormOpen(true);
  };

  const openEdit = (node: CategoryTreeNode) => {
    setEditing(node);
    setParentForCreate(null);
    setName(node.name);
    setCode(node.code ?? '');
    setSortOrder(String(node.sortOrder));
    setFormOpen(true);
  };

  const openMove = (node: CategoryTreeNode) => {
    setMoving(node);
    setMoveParentId(node.parentId ?? '');
    setMoveOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateCategory(companyId, editing.id, {
          name,
          code: code.trim() ? code.trim() : null,
          sortOrder: Number(sortOrder) || 0,
        });
      }
      return createCategory(companyId, {
        name,
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(parentForCreate ? { parentId: parentForCreate } : {}),
        sortOrder: Number(sortOrder) || 0,
      });
    },
    onSuccess: async () => {
      toast.success(editing ? 'دسته‌بندی به‌روز شد.' : 'دسته‌بندی ایجاد شد.');
      setFormOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const moveMutation = useMutation({
    mutationFn: () =>
      moveCategory(companyId, moving!.id, moveParentId ? moveParentId : null),
    onSuccess: async () => {
      toast.success('دسته‌بندی منتقل شد.');
      setMoveOpen(false);
      setMoving(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archiveCategory(companyId, id),
    onSuccess: async () => {
      toast.success('دسته‌بندی بایگانی شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => activateCategory(companyId, id),
    onSuccess: async () => {
      toast.success('دسته‌بندی فعال شد.');
      setConfirm(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.CATALOG_READ)) {
    return <AccessDenied />;
  }

  const tree = treeQuery.data ?? [];
  const flat = flattenTree(tree);
  const excludedForMove = moving
    ? new Set([moving.id, ...collectDescendantIds(moving)])
    : new Set<string>();

  const renderNode = (node: CategoryTreeNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    return (
      <div key={node.id}>
        <div
          className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 hover:bg-slate-50"
          style={{ paddingInlineStart: `${12 + depth * 20}px` }}
        >
          <button
            type="button"
            className={cn(
              'inline-flex h-7 w-7 items-center justify-center rounded text-slate-500',
              !hasChildren && 'invisible',
            )}
            aria-label={isOpen ? 'بستن' : 'باز کردن'}
            onClick={() => {
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(node.id)) next.delete(node.id);
                else next.add(node.id);
                return next;
              });
            }}
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-900">{node.name}</div>
            <div className="truncate text-xs text-slate-500">
              {node.code ? `${node.code} · ` : ''}
              {statusLabel(node.status)}
            </div>
          </div>
          <Badge>{statusLabel(node.status)}</Badge>
          {canManage ? (
            <RowActionsMenu
              actions={[
                {
                  label: 'افزودن زیرمجموعه',
                  onSelect: () => openCreateChild(node),
                },
                { label: 'ویرایش', onSelect: () => openEdit(node) },
                {
                  label: 'مشخصات پیشنهادی',
                  onSelect: () => setAttributesFor(node),
                },
                { label: 'انتقال', onSelect: () => openMove(node) },
                node.status === 'ARCHIVED'
                  ? {
                      label: 'فعال‌سازی',
                      onSelect: () => setConfirm({ type: 'activate', category: node }),
                    }
                  : {
                      label: 'بایگانی',
                      onSelect: () => setConfirm({ type: 'archive', category: node }),
                      danger: true,
                    },
              ]}
            />
          ) : null}
        </div>
        {hasChildren && isOpen
          ? node.children.map((child) => renderNode(child, depth + 1))
          : null}
      </div>
    );
  };

  const searchRows = (searchQuery.data?.data ?? []) as Category[];
  const isLoading = search ? searchQuery.isLoading : treeQuery.isLoading;
  const isError = search ? searchQuery.isError : treeQuery.isError;
  const error = search ? searchQuery.error : treeQuery.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="دسته‌بندی‌ها"
        description="درخت طبقه‌بندی عملیاتی کاتالوگ شرکت فعال"
        breadcrumbs={[{ label: 'کاتالوگ', href: ROUTES.catalog }, { label: 'دسته‌بندی‌ها' }]}
        actions={
          canManage ? (
            <Button type="button" onClick={openCreateRoot}>
              دسته‌بندی جدید
            </Button>
          ) : null
        }
      />

      <div className="space-y-1">
        <Label htmlFor="category-search">جستجو</Label>
        <Input
          id="category-search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="نام یا کد دسته‌بندی"
        />
      </div>

      {isLoading ? <TableSkeleton rows={8} /> : null}
      {isError ? (
        <ErrorState
          title="خطا در دریافت دسته‌بندی‌ها"
          message={mapBusinessError(error)}
        />
      ) : null}

      {!isLoading && !isError && !search && tree.length === 0 ? (
        <EmptyState
          title="دسته‌بندی‌ای وجود ندارد"
          description="اولین دسته‌بندی ریشه را ایجاد کنید."
          action={
            canManage ? (
              <Button type="button" onClick={openCreateRoot}>
                ایجاد اولین دسته‌بندی
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {!isLoading && !isError && search ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          {searchRows.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              نتیجه‌ای پیدا نشد.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {searchRows.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900">{row.name}</div>
                    <div className="truncate text-xs text-slate-500">{row.path}</div>
                  </div>
                  <Badge>{statusLabel(row.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {!isLoading && !isError && !search && tree.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          {tree.map((node) => renderNode(node, 0))}
        </div>
      ) : null}

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'ویرایش دسته‌بندی' : 'دسته‌بندی جدید'}
        description={
          parentForCreate
            ? `زیرمجموعهٔ: ${findNode(tree, parentForCreate)?.name ?? ''}`
            : editing
              ? undefined
              : 'به‌عنوان دسته‌بندی ریشه ایجاد می‌شود.'
        }
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="category-name">نام</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="category-code">کد (اختیاری)</Label>
            <Input
              id="category-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={64}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="category-sort">ترتیب</Label>
            <Input
              id="category-sort"
              type="number"
              min={0}
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={saveMutation.isPending || !name.trim()}>
              {saveMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        title="انتقال دسته‌بندی"
        description={moving ? `مسیر فعلی: ${flattenTree(tree).find((n) => n.id === moving.id)?.path ?? moving.name}` : undefined}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="move-parent">دسته‌بندی والد</Label>
            <select
              id="move-parent"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={moveParentId}
              onChange={(event) => setMoveParentId(event.target.value)}
            >
              <option value="">(ریشه)</option>
              {flat
                .filter((node) => !excludedForMove.has(node.id))
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.path}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMoveOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={moveMutation.isPending}
              onClick={() => moveMutation.mutate()}
            >
              {moveMutation.isPending ? 'در حال انتقال...' : 'انتقال'}
            </Button>
          </div>
        </div>
      </Dialog>

      {attributesFor ? (
        <CategoryAttributesDialog
          open={Boolean(attributesFor)}
          onOpenChange={(open) => {
            if (!open) setAttributesFor(null);
          }}
          categoryId={attributesFor.id}
          categoryName={attributesFor.name}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={confirm?.type === 'archive' ? 'بایگانی دسته‌بندی' : 'فعال‌سازی دسته‌بندی'}
        description={
          confirm?.type === 'archive'
            ? 'دسته‌بندی و زیرمجموعه‌هایش حذف نمی‌شوند و سوابق حفظ می‌شود.'
            : 'دسته‌بندی دوباره فعال می‌شود.'
        }
        target={confirm?.category.name}
        confirmLabel={confirm?.type === 'archive' ? 'بایگانی' : 'فعال‌سازی'}
        danger={confirm?.type === 'archive'}
        loading={archiveMutation.isPending || activateMutation.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.type === 'archive') {
            archiveMutation.mutate(confirm.category.id);
          } else {
            activateMutation.mutate(confirm.category.id);
          }
        }}
      />
    </div>
  );
}
