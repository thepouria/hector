'use client';

import * as React from 'react';
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
import { fetchInventoryCostLayers } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function CostLayersPageClient() {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['warehouse', 'cost-layers', companyId, page],
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_COST_LAYER_READ),
    queryFn: () =>
      fetchInventoryCostLayers(companyId, { page, pageSize: 20, remainingOnly: true }),
  });

  if (!can(PERMISSIONS.WAREHOUSE_COST_LAYER_READ)) return <AccessDenied />;

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="لایه‌های بهای تمام‌شده (FIFO)"
        description="لایه‌های تحصیل انبارمحور. Batch ≠ لایه بها. مقدار باقی‌مانده و وضعیت ارزش‌گذاری."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'لایه‌های بهای تمام‌شده' },
        ]}
      />

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="لایه‌ای یافت نشد." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">منبع</th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">بچ</th>
                <th className="px-3 py-2 font-medium">دریافت</th>
                <th className="px-3 py-2 font-medium">اصلی</th>
                <th className="px-3 py-2 font-medium">مانده</th>
                <th className="px-3 py-2 font-medium">بهای واحد</th>
                <th className="px-3 py-2 font-medium">ارز</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.sourceType}</td>
                  <td className="px-3 py-2">{row.sku?.code ?? row.skuId}</td>
                  <td className="px-3 py-2">{row.batch?.batchNumber ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.receivedAt)}</td>
                  <td className="px-3 py-2 tabular-nums">{row.originalQuantity}</td>
                  <td className="px-3 py-2 tabular-nums">{row.remainingQuantity}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.baseCurrencyUnitCost ?? '—'}
                  </td>
                  <td className="px-3 py-2">{row.originalCurrency ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge>{row.valuationStatus}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            قبلی
          </Button>
          <span className="text-sm text-slate-600">
            صفحه {page} از {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            بعدی
          </Button>
        </div>
      ) : null}
    </div>
  );
}
