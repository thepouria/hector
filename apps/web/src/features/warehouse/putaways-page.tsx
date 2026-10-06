'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatBatchDateOnly } from '@/features/warehouse/batch-labels';
import {
  putawayStatusLabel,
  receiptPutawayProgressLabel,
} from '@/features/warehouse/putaway-labels';
import { createPutaway, fetchPendingPutaways, fetchPutaways } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import {
  ROUTES,
  warehouseGoodsReceiptPath,
  warehousePutawayPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { PutawayStatus } from '@/types/putaway';

type TabId = 'list' | 'pending';

export function PutawaysPageClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.WAREHOUSE_PUTAWAY_MANAGE);

  const [tab, setTab] = React.useState<TabId>('pending');
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<PutawayStatus | ''>('');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [creatingFor, setCreatingFor] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  React.useEffect(() => {
    setPage(1);
  }, [tab]);

  const listFilters = {
    page,
    pageSize: 20,
    status: status || undefined,
    q: search || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  const pendingFilters = {
    page,
    pageSize: 20,
    q: search || undefined,
  };

  const listQuery = useQuery({
    queryKey: warehouseKeys.putaways.list(companyId, listFilters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_PUTAWAY_READ) && tab === 'list',
    queryFn: () => fetchPutaways(companyId, listFilters),
  });

  const pendingQuery = useQuery({
    queryKey: warehouseKeys.putaways.pending(companyId, pendingFilters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_PUTAWAY_READ) && tab === 'pending',
    queryFn: () => fetchPendingPutaways(companyId, pendingFilters),
  });

  const startPutaway = useMutation({
    mutationFn: (input: { goodsReceiptId: string; allocationId?: string }) =>
      createPutaway(companyId, { goodsReceiptId: input.goodsReceiptId }),
    onMutate: (input) => {
      setCreatingFor(input.goodsReceiptId);
    },
    onSuccess: async (putaway, input) => {
      await queryClient.invalidateQueries({ queryKey: warehouseKeys.putaways.all(companyId) });
      toast.success(`جایگذاری ${putaway.number} ایجاد شد.`);
      const href = input.allocationId
        ? `${warehousePutawayPath(putaway.id)}?allocation=${input.allocationId}`
        : warehousePutawayPath(putaway.id);
      router.push(href);
    },
    onError: (error) => toast.error(mapBusinessError(error)),
    onSettled: () => setCreatingFor(null),
  });

  if (!can(PERMISSIONS.WAREHOUSE_PUTAWAY_READ)) return <AccessDenied />;

  const listRows = listQuery.data?.data ?? [];
  const pendingRows = pendingQuery.data?.data ?? [];
  const meta = tab === 'list' ? listQuery.data?.meta : pendingQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
  const isLoading = tab === 'list' ? listQuery.isPending : pendingQuery.isPending;
  const isError = tab === 'list' ? listQuery.isError : pendingQuery.isError;
  const queryError = tab === 'list' ? listQuery.error : pendingQuery.error;
  const refetch = tab === 'list' ? listQuery.refetch : pendingQuery.refetch;
  const isEmpty = tab === 'list' ? listRows.length === 0 : pendingRows.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="جایگذاری"
        description="ثبت تاریخچهٔ قرارگیری کالای دریافت‌شده در مکان‌های انبار — نه موجودی لحظه‌ای."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'جایگذاری' },
        ]}
      />

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <Button
          type="button"
          variant={tab === 'pending' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setTab('pending')}
        >
          در انتظار جایگذاری
        </Button>
        <Button
          type="button"
          variant={tab === 'list' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setTab('list')}
        >
          فهرست جایگذاری‌ها
        </Button>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="putaway-search">جستجو</Label>
          <Input
            id="putaway-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={tab === 'list' ? 'شماره PUT، GRN یا انبار' : 'GRN، SKU یا بچ'}
          />
        </div>
        {tab === 'list' ? (
          <div className="space-y-1">
            <Label htmlFor="putaway-status">وضعیت</Label>
            <select
              id="putaway-status"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as PutawayStatus | '');
                setPage(1);
              }}
            >
              <option value="">همه</option>
              <option value="DRAFT">پیش‌نویس</option>
              <option value="IN_PROGRESS">در حال جایگذاری</option>
              <option value="COMPLETED">تکمیل‌شده</option>
              <option value="CANCELLED">لغو شده</option>
            </select>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <ErrorState message={mapBusinessError(queryError)} onRetry={() => refetch()} />
      ) : isEmpty ? (
        <EmptyState
          title={tab === 'pending' ? 'ردیفی برای جایگذاری باقی نمانده است.' : 'جایگذاری ثبت نشده است.'}
          description={
            tab === 'pending'
              ? 'پس از ثبت نهایی رسید و تخصیص بچ، اقلام با باقیماندهٔ جایگذاری اینجا نمایش داده می‌شوند.'
              : 'از تب «در انتظار جایگذاری» یک رسید را شروع کنید یا از رسید ثبت‌شده جایگذاری بسازید.'
          }
        />
      ) : tab === 'list' ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">شماره PUT</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">رسید</th>
                <th className="px-3 py-2 text-start font-medium">انبار</th>
                <th className="px-3 py-2 text-start font-medium">تعداد</th>
                <th className="px-3 py-2 text-start font-medium">ایجاد</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(warehousePutawayPath(row.id))}
                >
                  <td className="px-3 py-2 font-medium text-slate-900">{row.number}</td>
                  <td className="px-3 py-2">
                    <Badge>{putawayStatusLabel(row.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={warehouseGoodsReceiptPath(row.goodsReceiptId)}
                      className="underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.goodsReceiptNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs" dir="ltr">
                      {row.warehouseCode}
                    </span>
                    <span className="ms-1">{row.warehouseName}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.totalQuantity}
                    <span className="ms-1 text-xs text-slate-500">({row.itemCount} ردیف)</span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">رسید</th>
                <th className="px-3 py-2 text-start font-medium">SKU / محصول</th>
                <th className="px-3 py-2 text-start font-medium">بچ</th>
                <th className="px-3 py-2 text-start font-medium">دریافت‌شده</th>
                <th className="px-3 py-2 text-start font-medium">قبلاً جایگذاری</th>
                <th className="px-3 py-2 text-start font-medium">باقیمانده</th>
                <th className="px-3 py-2 text-start font-medium">پیشرفت رسید</th>
                <th className="px-3 py-2 text-start font-medium" />
              </tr>
            </thead>
            <tbody>
              {pendingRows.map((row) => (
                <tr key={row.receiptBatchAllocationId} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link
                      href={warehouseGoodsReceiptPath(row.goodsReceiptId)}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {row.goodsReceiptNumber}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {row.warehouseCode} · {row.warehouseName}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs" dir="ltr">
                      {row.skuCode ?? '—'}
                    </div>
                    <div>{row.productName ?? '—'}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs" dir="ltr">
                      {row.batchNumber}
                    </div>
                    {row.expiresAt ? (
                      <div className="text-xs text-slate-500">
                        انقضا: {formatBatchDateOnly(row.expiresAt)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.receivedQuantity}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.alreadyPutAway}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-medium" dir="ltr">
                    {row.remainingToPutAway}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{receiptPutawayProgressLabel(row.receiptPutawayProgress)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-end">
                    {canManage ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={startPutaway.isPending && creatingFor === row.goodsReceiptId}
                        onClick={() =>
                          startPutaway.mutate({
                            goodsReceiptId: row.goodsReceiptId,
                            allocationId: row.receiptBatchAllocationId,
                          })
                        }
                      >
                        جایگذاری
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && meta.total > meta.pageSize ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            صفحه {meta.page} از {totalPages} · {meta.total} مورد
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              قبلی
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              بعدی
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
