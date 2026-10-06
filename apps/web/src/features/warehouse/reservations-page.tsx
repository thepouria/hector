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
import { fetchInventoryReservations } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function ReservationsPageClient() {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['warehouse', 'reservations', companyId, page],
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_RESERVATION_READ),
    queryFn: () => fetchInventoryReservations(companyId, { page, pageSize: 20 }),
  });

  if (!can(PERMISSIONS.WAREHOUSE_RESERVATION_READ)) return <AccessDenied />;

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="رزرو موجودی"
        description="تعهد فروش‌پذیر (SELLABLE) بدون حرکت فیزیکی. On Hand تغییر نمی‌کند؛ Available = On Hand − Reserved."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'رزرو موجودی' },
        ]}
      />

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="رزروی ثبت نشده است." description="رزروها برای کانال‌های فروش آینده استفاده می‌شوند." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-600">
              <tr>
                <th className="px-3 py-2 font-medium">منبع</th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">انبار</th>
                <th className="px-3 py-2 font-medium">مقدار</th>
                <th className="px-3 py-2 font-medium">مانده</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
                <th className="px-3 py-2 font-medium">ایجاد</th>
                <th className="px-3 py-2 font-medium">انقضا</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{row.sourceType}</td>
                  <td className="px-3 py-2">
                    {row.sku?.code ?? row.skuId}
                    {row.sku?.product?.name ? (
                      <div className="text-xs text-slate-500">{row.sku.product.name}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{row.warehouse?.code ?? row.warehouseId}</td>
                  <td className="px-3 py-2 tabular-nums">{row.quantity}</td>
                  <td className="px-3 py-2 tabular-nums">{row.remainingQuantity}</td>
                  <td className="px-3 py-2">
                    <Badge>{row.status}</Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {row.expiresAt ? formatDateTime(row.expiresAt) : '—'}
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
