'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
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
import {
  batchExpiryBadgeClass,
  batchExpiryStateLabel,
  formatBatchDateOnly,
} from '@/features/warehouse/batch-labels';
import { fetchBatches } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, warehouseBatchPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function BatchesPageClient() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const filters = {
    page,
    pageSize: 20,
    q: search || undefined,
    sortBy: 'createdAt',
    sortOrder: 'desc',
  };

  const query = useQuery({
    queryKey: warehouseKeys.batches.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_BATCH_READ),
    queryFn: () => fetchBatches(companyId, filters),
  });

  if (!can(PERMISSIONS.WAREHOUSE_BATCH_READ)) return <AccessDenied />;

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="بچ / سری ساخت"
        description="شناسه بچ و سابقه دریافت از رسیدهای ثبت‌شده — «مجموع دریافت» فقط از رسیدهای ثبت نهایی است و موجودی فعلی نیست."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'بچ / سری ساخت' },
        ]}
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <Label htmlFor="batch-search">جستجو</Label>
          <Input
            id="batch-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="شماره بچ، سری سازنده، SKU یا نام محصول"
          />
        </div>
      </div>

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="بچی ثبت نشده است."
          description="بچ‌ها هنگام تخصیص روی رسید پیش‌نویس یا از طریق دریافت با بارکدخوان ایجاد می‌شوند."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">بچ داخلی</th>
                <th className="px-3 py-2 text-start font-medium">سری سازنده</th>
                <th className="px-3 py-2 text-start font-medium">SKU</th>
                <th className="px-3 py-2 text-start font-medium">محصول</th>
                <th className="px-3 py-2 text-start font-medium">انقضا</th>
                <th className="px-3 py-2 text-start font-medium">مجموع دریافت</th>
                <th className="px-3 py-2 text-start font-medium">اولین دریافت</th>
                <th className="px-3 py-2 text-start font-medium">آخرین دریافت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(warehouseBatchPath(row.id))}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={warehouseBatchPath(row.id)}
                      className="font-mono text-xs font-medium underline-offset-2 hover:underline"
                      dir="ltr"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.batchNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {row.supplierBatchNumber ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {row.skuCode}
                  </td>
                  <td className="px-3 py-2">{row.productName ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge className={batchExpiryBadgeClass(row.expiryState)}>
                      {batchExpiryStateLabel(row.expiryState)}
                    </Badge>
                    {row.expiresAt ? (
                      <div className="mt-0.5 text-xs text-slate-500" dir="ltr">
                        {formatBatchDateOnly(row.expiresAt)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.totalReceived}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {row.firstReceivedAt ? formatDateTime(row.firstReceivedAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {row.lastReceivedAt ? formatDateTime(row.lastReceivedAt) : '—'}
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
