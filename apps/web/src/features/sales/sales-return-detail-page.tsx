'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { returnStatusLabel } from '@/features/sales/sales-labels';
import {
  approveSalesReturn,
  cancelSalesReturn,
  fetchBatches,
  fetchSalesReturn,
  fetchWarehouseLocations,
  fetchWarehouses,
  receiveSalesReturn,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { ROUTES, salesOrderPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SalesReturnDetailPage({ returnId }: { returnId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canRead = can(PERMISSIONS.SALES_RETURNS_READ);

  const [warehouseId, setWarehouseId] = React.useState('');
  const [locationId, setLocationId] = React.useState('');
  const [batchId, setBatchId] = React.useState('');
  const [confirmCancel, setConfirmCancel] = React.useState(false);

  const query = useQuery({
    queryKey: salesKeys.returns.detail(companyId, returnId),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSalesReturn(companyId, returnId),
  });

  const warehousesQuery = useQuery({
    queryKey: ['warehouses', companyId, 'sales-return'],
    enabled: Boolean(companyId),
    queryFn: () => fetchWarehouses(companyId, { pageSize: 50, status: 'ACTIVE' }),
  });

  React.useEffect(() => {
    if (!warehouseId && (warehousesQuery.data?.data?.length ?? 0) > 0) {
      const preferred =
        warehousesQuery.data!.data.find((w) => w.isDefault) ?? warehousesQuery.data!.data[0]!;
      setWarehouseId(preferred.id);
    }
  }, [warehouseId, warehousesQuery.data]);

  const locationsQuery = useQuery({
    queryKey: ['warehouse-locations', companyId, warehouseId, 'return'],
    enabled: Boolean(warehouseId),
    queryFn: () =>
      fetchWarehouseLocations(companyId, warehouseId, { pageSize: 100, status: 'ACTIVE' }),
  });

  const batchesQuery = useQuery({
    queryKey: ['batches', companyId, 'return'],
    enabled: Boolean(companyId),
    queryFn: () => fetchBatches(companyId, { pageSize: 50 }),
  });

  React.useEffect(() => {
    if (query.error && isApiClientError(query.error) && query.error.status === 401) {
      handleUnauthorized();
    }
  }, [query.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: salesKeys.returns.detail(companyId, returnId),
    });
    await queryClient.invalidateQueries({ queryKey: salesKeys.returns.all(companyId) });
  };

  const approveMut = useMutation({
    mutationFn: () => approveSalesReturn(companyId, returnId),
    onSuccess: async () => {
      toast.success('برگشت تأیید شد');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const receiveMut = useMutation({
    mutationFn: async () => {
      const ret = query.data!;
      if (!warehouseId || !locationId || !batchId) {
        throw new Error('انبار، محل و بچ الزامی است.');
      }
      return receiveSalesReturn(companyId, returnId, {
        warehouseId,
        items: ret.items.map((item) => ({
          salesReturnItemId: item.id,
          locationId,
          batchId,
          classification: item.condition === 'DAMAGED' ? 'DAMAGED' : 'SELLABLE',
        })),
      });
    },
    onSuccess: async () => {
      toast.success('دریافت فیزیکی ثبت شد');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelSalesReturn(companyId, returnId, {}),
    onSuccess: async () => {
      toast.success('برگشت لغو شد');
      setConfirmCancel(false);
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) {
    return <AccessDenied message="مجوز مشاهده برگشت ندارید." />;
  }
  if (query.isLoading) return <PageSkeleton />;
  if (query.error) {
    return <ErrorState title="خطا" message={mapBusinessError(query.error)} />;
  }

  const ret = query.data!;
  const canApprove = can(PERMISSIONS.SALES_RETURNS_APPROVE) && ret.status === 'DRAFT';
  const canReceive = can(PERMISSIONS.SALES_RETURNS_RECEIVE) && ret.status === 'APPROVED';
  const canCancel =
    can(PERMISSIONS.SALES_RETURNS_MANAGE) &&
    (ret.status === 'DRAFT' || ret.status === 'APPROVED');

  return (
    <div className="space-y-4">
      <PageHeader
        title={ret.returnNumber}
        description="برگشت فروش — تسویه نقدی در فاز ۶"
        breadcrumbs={[
          { label: 'فروش', href: ROUTES.sales },
          { label: 'برگشت‌ها', href: ROUTES.salesReturns },
          { label: ret.returnNumber },
        ]}
        actions={<Badge>{returnStatusLabel(ret.status)}</Badge>}
      />

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm space-y-1">
        <div>
          سفارش:{' '}
          <Link href={salesOrderPath(ret.salesOrderId)} className="text-sky-700 hover:underline">
            {ret.salesOrder?.orderNumber ?? ret.salesOrderId}
          </Link>
        </div>
        <div>ایجاد: {formatDateTime(ret.createdAt)}</div>
        <div>تأیید: {ret.approvedAt ? formatDateTime(ret.approvedAt) : '—'}</div>
        <div>دریافت: {ret.receivedAt ? formatDateTime(ret.receivedAt) : '—'}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canApprove ? (
          <Button disabled={approveMut.isPending} onClick={() => approveMut.mutate()}>
            تأیید تجاری
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="danger" onClick={() => setConfirmCancel(true)}>
            لغو
          </Button>
        ) : null}
      </div>

      {canReceive ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
          <div className="space-y-1">
            <Label>انبار</Label>
            <select
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
            >
              {(warehousesQuery.data?.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>محل</Label>
            <select
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">انتخاب</option>
              {(locationsQuery.data?.data ?? []).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>بچ</Label>
            <select
              className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
              value={batchId}
              onChange={(e) => setBatchId(e.target.value)}
            >
              <option value="">انتخاب</option>
              {(batchesQuery.data?.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchNumber}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <Button disabled={receiveMut.isPending} onClick={() => receiveMut.mutate()}>
              دریافت فیزیکی (RETURN_IN)
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-right">SKU</th>
              <th className="px-3 py-2 text-right">تعداد</th>
              <th className="px-3 py-2 text-right">شرط</th>
            </tr>
          </thead>
          <tbody>
            {ret.items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{item.sku?.code ?? item.skuId.slice(0, 8)}</td>
                <td className="px-3 py-2 tabular-nums">{item.quantity}</td>
                <td className="px-3 py-2">{item.condition ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="لغو برگشت؟"
        confirmLabel="لغو"
        onConfirm={() => cancelMut.mutate()}
        loading={cancelMut.isPending}
        danger
      />
    </div>
  );
}
