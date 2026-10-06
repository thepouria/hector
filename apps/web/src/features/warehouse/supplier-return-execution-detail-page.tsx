'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SupplierReturnScannerPanel } from '@/features/warehouse/supplier-return-scanner-panel';
import {
  actorDisplayName,
  stockClassificationLabel,
  supplierReturnExecutionStatusLabel,
} from '@/features/warehouse/supplier-return-labels';
import { WarehouseEntityActivity } from '@/features/warehouse/warehouse-entity-activity';
import {
  cancelSupplierReturnExecution,
  dispatchSupplierReturnExecution,
  fetchSupplierReturnExecution,
  fetchWarehouseSupplierReturn,
  removeSupplierReturnExecutionItem,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  warehouseSupplierReturnExecutionMovementsPath,
  warehouseSupplierReturnPath,
  warehouseInventoryPositionMovementsPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SupplierReturnExecutionDetailPageClient({ executionId }: { executionId: string }) {
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canUpdate = can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_UPDATE_EXECUTION);
  const canDispatch = can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_DISPATCH);
  const canCancel = can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CANCEL_EXECUTION);

  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const query = useQuery({
    queryKey: warehouseKeys.supplierReturnExecutions.detail(companyId, executionId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ),
    queryFn: () => fetchSupplierReturnExecution(companyId, executionId),
  });

  const row = query.data;
  const isDraft = row?.status === 'DRAFT';

  const returnQuery = useQuery({
    queryKey: warehouseKeys.supplierReturns.detail(companyId, row?.purchaseReturnId ?? ''),
    enabled: Boolean(companyId) && Boolean(row?.purchaseReturnId),
    queryFn: () => fetchWarehouseSupplierReturn(companyId, row!.purchaseReturnId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.supplierReturnExecutions.detail(companyId, executionId),
    });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.supplierReturnExecutions.all(companyId),
    });
    if (row?.purchaseReturnId) {
      await queryClient.invalidateQueries({
        queryKey: warehouseKeys.supplierReturns.detail(companyId, row.purchaseReturnId),
      });
      await queryClient.invalidateQueries({
        queryKey: warehouseKeys.supplierReturns.all(companyId),
      });
    }
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.inventory.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.dashboard(companyId) });
  };

  const onExecutionUpdated = (updated: NonNullable<typeof row>) => {
    queryClient.setQueryData(
      warehouseKeys.supplierReturnExecutions.detail(companyId, executionId),
      updated,
    );
  };

  const dispatchMutation = useMutation({
    mutationFn: () => dispatchSupplierReturnExecution(companyId, executionId),
    onSuccess: async (updated) => {
      toast.success('ارسال ثبت شد — RETURN_OUT در دفتر حرکات.');
      setDispatchOpen(false);
      onExecutionUpdated(updated);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelSupplierReturnExecution(companyId, executionId),
    onSuccess: async (updated) => {
      toast.success('پیش‌نویس لغو شد.');
      setCancelOpen(false);
      onExecutionUpdated(updated);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removeSupplierReturnExecutionItem(companyId, executionId, itemId),
    onSuccess: async (updated) => {
      toast.success('قلم حذف شد.');
      onExecutionUpdated(updated);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError) {
    return <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!row) return <ErrorState message="اجرا یافت نشد." />;

  const returnItems = returnQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description={`${row.purchaseReturnNumber} · ${row.warehouse.code}`}
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'برگشت به تأمین‌کننده', href: ROUTES.warehouseSupplierReturns },
          {
            label: row.purchaseReturnNumber,
            href: warehouseSupplierReturnPath(row.purchaseReturnId),
          },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {isDraft && canDispatch && row.items.length > 0 ? (
              <Button type="button" onClick={() => setDispatchOpen(true)}>
                تأیید ارسال
              </Button>
            ) : null}
            {isDraft && canCancel ? (
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                لغو پیش‌نویس
              </Button>
            ) : null}
            {row.status === 'DISPATCHED' ? (
              <Link
                href={warehouseSupplierReturnExecutionMovementsPath(executionId)}
                className={cn(buttonVariants({ variant: 'outline' }))}
              >
                حرکات RETURN_OUT
              </Link>
            ) : null}
            <Link
              href={warehouseSupplierReturnPath(row.purchaseReturnId)}
              className={cn(buttonVariants({ variant: 'ghost' }))}
            >
              بازگشت
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
        <div>
          <div className="text-xs text-slate-500">وضعیت</div>
          <Badge>{supplierReturnExecutionStatusLabel(row.status)}</Badge>
        </div>
        <div>
          <div className="text-xs text-slate-500">انبار</div>
          <div className="font-mono text-sm" dir="ltr">
            {row.warehouse.code}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ایجادکننده</div>
          <div>{actorDisplayName(row.createdBy)}</div>
          <div className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ارسال‌کننده</div>
          <div>{actorDisplayName(row.dispatchedBy)}</div>
          <div className="text-xs text-slate-500">
            {row.dispatchedAt ? formatDateTime(row.dispatchedAt) : '—'}
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="text-xs text-slate-500">یادداشت</div>
          <div className="text-sm">{row.notes ?? '—'}</div>
        </div>
      </div>

      {row.status === 'DISPATCHED' ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          این اجرا ارسال شده است. موجودی از انبار خارج شده و لغو مستقیم مجاز نیست.
        </div>
      ) : null}

      {isDraft && canUpdate && returnItems.length > 0 ? (
        <SupplierReturnScannerPanel
          companyId={companyId}
          executionId={executionId}
          execution={row}
          returnItems={returnItems}
          onExecutionUpdated={onExecutionUpdated}
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">اقلام تخصیص</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">مکان</th>
                <th className="px-3 py-2 text-start font-medium">SKU</th>
                <th className="px-3 py-2 text-start font-medium">بچ</th>
                <th className="px-3 py-2 text-start font-medium">طبقه‌بندی</th>
                <th className="px-3 py-2 text-start font-medium">تعداد</th>
                <th className="px-3 py-2 text-start font-medium">On Hand</th>
                <th className="px-3 py-2 text-start font-medium">حرکات</th>
                {isDraft && canUpdate ? (
                  <th className="px-3 py-2 text-start font-medium">عملیات</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {row.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {item.location.code}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs" dir="ltr">
                      {item.skuCode}
                    </div>
                    <div className="text-xs text-slate-600">{item.productName ?? '—'}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {item.batchNumber}
                  </td>
                  <td className="px-3 py-2">{stockClassificationLabel(item.classification)}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.sourceOnHand}
                  </td>
                  <td className="px-3 py-2">
                    {row.status === 'DISPATCHED' ? (
                      <Link
                        href={warehouseInventoryPositionMovementsPath({
                          skuId: item.skuId,
                          batchId: item.batchId,
                          warehouseId: row.warehouse.id,
                          locationId: item.location.id,
                        })}
                        className="text-xs text-blue-700 underline-offset-2 hover:underline"
                      >
                        موقعیت
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  {isDraft && canUpdate ? (
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={removeItemMutation.isPending}
                        onClick={() => removeItemMutation.mutate(item.id)}
                      >
                        حذف
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={dispatchOpen}
        onOpenChange={setDispatchOpen}
        title="تأیید ارسال به تأمین‌کننده"
        description="با تأیید، برای هر قلم یک حرکت RETURN_OUT ثبت می‌شود و موجودی کاهش می‌یابد. این عمل برای پیش‌نویس غیرقابل بازگشت است."
        confirmLabel="ارسال"
        onConfirm={() => dispatchMutation.mutate()}
        loading={dispatchMutation.isPending}
      />

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="لغو پیش‌نویس"
        description="پیش‌نویس بدون اثر بر موجودی لغو می‌شود."
        confirmLabel="لغو"
        onConfirm={() => cancelMutation.mutate()}
        loading={cancelMutation.isPending}
      />

      <WarehouseEntityActivity
        kind="SUPPLIER_RETURN_EXECUTION"
        entityId={executionId}
        readPermission={PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ}
      />
    </div>
  );
}
