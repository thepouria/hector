'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  createSupplierReturnExecution,
  fetchWarehouseSupplierReturn,
  fetchWarehouses,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import {
  ROUTES,
  warehouseSupplierReturnExecutionPath,
  warehouseSupplierReturnPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

export function SupplierReturnExecutionCreatePageClient({
  purchaseReturnId,
}: {
  purchaseReturnId: string;
}) {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CREATE_EXECUTION);

  const [warehouseId, setWarehouseId] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const returnQuery = useQuery({
    queryKey: warehouseKeys.supplierReturns.detail(companyId, purchaseReturnId),
    enabled: Boolean(companyId) && canCreate,
    queryFn: () => fetchWarehouseSupplierReturn(companyId, purchaseReturnId),
  });

  const warehousesQuery = useQuery({
    queryKey: warehouseKeys.list(companyId, { status: 'ACTIVE', pageSize: 100, sortBy: 'name' }),
    enabled: Boolean(companyId) && canCreate,
    queryFn: () =>
      fetchWarehouses(companyId, {
        status: 'ACTIVE',
        pageSize: 100,
        sortBy: 'name',
        sortOrder: 'asc',
      }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createSupplierReturnExecution(companyId, purchaseReturnId, {
        warehouseId,
        notes: notes.trim() || undefined,
      }),
    onSuccess: (created) => {
      toast.success('پیش‌نویس اجرا ایجاد شد.');
      router.push(warehouseSupplierReturnExecutionPath(created.id));
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!canCreate) return <AccessDenied />;
  if (returnQuery.isPending || warehousesQuery.isPending) return <PageSkeleton />;
  if (returnQuery.isError) {
    return (
      <ErrorState message={mapBusinessError(returnQuery.error)} onRetry={() => returnQuery.refetch()} />
    );
  }
  const purchaseReturn = returnQuery.data;
  if (!purchaseReturn) return <ErrorState message="برگشت خرید یافت نشد." />;

  const warehouses = warehousesQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="اجرای جدید"
        description={`${purchaseReturn.number} · مانده ${purchaseReturn.progress.remainingQuantity}`}
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'برگشت به تأمین‌کننده', href: ROUTES.warehouseSupplierReturns },
          { label: purchaseReturn.number, href: warehouseSupplierReturnPath(purchaseReturnId) },
          { label: 'اجرای جدید' },
        ]}
      />

      <form
        className="max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!warehouseId) {
            toast.error('انبار را انتخاب کنید.');
            return;
          }
          createMutation.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="sre-wh">انبار اجرا</Label>
          <select
            id="sre-wh"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            required
          >
            <option value="">انتخاب انبار…</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sre-notes">یادداشت</Label>
          <textarea
            id="sre-notes"
            className={textareaClassName}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={createMutation.isPending}>
            ایجاد پیش‌نویس
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(warehouseSupplierReturnPath(purchaseReturnId))}
          >
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
