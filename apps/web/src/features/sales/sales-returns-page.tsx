'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { returnStatusLabel } from '@/features/sales/sales-labels';
import {
  createSalesReturn,
  fetchSalesOrder,
  fetchSalesReturns,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { ROUTES, salesOrderPath, salesReturnPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SalesReturnsPage() {
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canRead = can(PERMISSIONS.SALES_RETURNS_READ);
  const canCreate = can(PERMISSIONS.SALES_RETURNS_CREATE);

  const [status, setStatus] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(searchParams.get('create') === '1');
  const [orderIdInput, setOrderIdInput] = React.useState(searchParams.get('salesOrderId') ?? '');

  const listQuery = useQuery({
    queryKey: salesKeys.returns.list(companyId, { status: status || undefined, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () =>
      fetchSalesReturns(companyId, { status: status || undefined, pageSize: 50 }),
  });

  const orderPreview = useQuery({
    queryKey: salesKeys.orders.detail(companyId, orderIdInput),
    enabled: Boolean(companyId) && createOpen && orderIdInput.length > 20,
    queryFn: () => fetchSalesOrder(companyId, orderIdInput),
    retry: false,
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  const createMut = useMutation({
    mutationFn: async () => {
      const order = orderPreview.data;
      if (!order) throw new Error('سفارش معتبر انتخاب کنید.');
      const items = order.items
        .map((item) => {
          const returnable =
            (item.quantities?.fulfilled ?? item.fulfilledQuantity) -
            (item.quantities?.returned ?? item.returnedQuantity);
          if (returnable < 1) return null;
          return {
            salesOrderItemId: item.id,
            skuId: item.skuId,
            quantity: returnable,
            reason: 'CUSTOMER_REQUEST',
            condition: 'SELLABLE',
          };
        })
        .filter(Boolean);
      if (items.length === 0) throw new Error('قلم قابل برگشتی نیست.');
      return createSalesReturn(companyId, {
        salesOrderId: order.id,
        reason: 'CUSTOMER_REQUEST',
        condition: 'SELLABLE',
        items,
      });
    },
    onSuccess: async (ret) => {
      toast.success(`برگشت ${ret.returnNumber} ایجاد شد`);
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: salesKeys.returns.all(companyId) });
      window.location.href = salesReturnPath(ret.id);
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) {
    return <AccessDenied message="برای مشاهده برگشت‌ها به مجوز sales.returns.read نیاز است." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="برگشت از مشتری"
        description="قصد تجاری برگشت؛ دریافت فیزیکی جداگانه است"
        breadcrumbs={[{ label: 'فروش', href: ROUTES.sales }, { label: 'برگشت‌ها' }]}
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>برگشت جدید</Button>
          ) : null
        }
      />

      <div className="space-y-1">
        <Label>وضعیت</Label>
        <select
          className="h-10 rounded-md border border-slate-200 px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">همه</option>
          {['DRAFT', 'APPROVED', 'RECEIVED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {returnStatusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {listQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {listQuery.error ? (
        <ErrorState title="خطا" message={mapBusinessError(listQuery.error)} />
      ) : null}
      {listQuery.data?.data.length === 0 ? (
        <EmptyState title="برگشتی نیست" description="از جزئیات سفارش یا اینجا برگشت بسازید." />
      ) : null}

      {listQuery.data && listQuery.data.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-right">شماره</th>
                <th className="px-3 py-2 text-right">وضعیت</th>
                <th className="px-3 py-2 text-right">سفارش</th>
                <th className="px-3 py-2 text-right">تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link href={salesReturnPath(r.id)} className="text-sky-700 hover:underline">
                      {r.returnNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{returnStatusLabel(r.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={salesOrderPath(r.salesOrderId)}
                      className="text-sky-700 hover:underline"
                    >
                      {r.salesOrder?.orderNumber ?? r.salesOrderId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="برگشت از سفارش">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>شناسه سفارش (UUID)</Label>
            <Input
              value={orderIdInput}
              onChange={(e) => setOrderIdInput(e.target.value.trim())}
              placeholder="از جزئیات سفارش کپی کنید"
            />
          </div>
          {orderPreview.data ? (
            <p className="text-sm text-slate-600">
              سفارش {orderPreview.data.orderNumber} — اقلام قابل برگشت بر اساس
              fulfilled − returned ساخته می‌شود.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              انصراف
            </Button>
            <Button
              disabled={createMut.isPending || !orderPreview.data}
              onClick={() => createMut.mutate()}
            >
              ایجاد پیش‌نویس
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
