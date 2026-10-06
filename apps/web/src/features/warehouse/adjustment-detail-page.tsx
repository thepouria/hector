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
import {
  actorDisplayName,
  inventoryAdjustmentDirectionLabel,
  inventoryAdjustmentReasonLabel,
  inventoryAdjustmentStatusLabel,
  stockClassificationLabel,
} from '@/features/warehouse/inventory-adjustment-labels';
import { WarehouseEntityActivity } from '@/features/warehouse/warehouse-entity-activity';
import {
  approveInventoryAdjustment,
  cancelInventoryAdjustment,
  fetchInventoryAdjustment,
  postInventoryAdjustment,
  rejectInventoryAdjustment,
  removeInventoryAdjustmentItem,
  submitInventoryAdjustment,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, warehouseInventoryPositionMovementsPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function AdjustmentDetailPageClient({ adjustmentId }: { adjustmentId: string }) {
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canUpdate = can(PERMISSIONS.WAREHOUSE_ADJUSTMENT_UPDATE);
  const canApprove = can(PERMISSIONS.WAREHOUSE_ADJUSTMENT_APPROVE);
  const canPost = can(PERMISSIONS.WAREHOUSE_ADJUSTMENT_POST);
  const canCancel = can(PERMISSIONS.WAREHOUSE_ADJUSTMENT_CANCEL);

  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [postOpen, setPostOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const query = useQuery({
    queryKey: warehouseKeys.adjustments.detail(companyId, adjustmentId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ),
    queryFn: () => fetchInventoryAdjustment(companyId, adjustmentId),
  });

  const row = query.data;
  const isDraft = row?.status === 'DRAFT';
  const isPendingApproval = row?.status === 'PENDING_APPROVAL';
  const isApproved = row?.status === 'APPROVED';
  const isPosted = row?.status === 'POSTED';

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.adjustments.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.inventory.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.dashboard(companyId) });
  };

  const submitMutation = useMutation({
    mutationFn: () => submitInventoryAdjustment(companyId, adjustmentId),
    onSuccess: async () => {
      toast.success('تعدیل برای تأیید ارسال شد.');
      setSubmitOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveInventoryAdjustment(companyId, adjustmentId),
    onSuccess: async () => {
      toast.success('تعدیل تأیید شد.');
      setApproveOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectInventoryAdjustment(companyId, adjustmentId),
    onSuccess: async () => {
      toast.success('تعدیل رد شد.');
      setRejectOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const postMutation = useMutation({
    mutationFn: () => postInventoryAdjustment(companyId, adjustmentId),
    onSuccess: async () => {
      toast.success('تعدیل ثبت شد و موجودی به‌روز شد.');
      setPostOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelInventoryAdjustment(companyId, adjustmentId),
    onSuccess: async () => {
      toast.success('تعدیل لغو شد.');
      setCancelOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removeInventoryAdjustmentItem(companyId, adjustmentId, itemId),
    onSuccess: async () => {
      toast.success('قلم حذف شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError) {
    return <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!row) return <ErrorState message="تعدیل یافت نشد." />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description={`${inventoryAdjustmentReasonLabel(row.reason)} · ${row.warehouse.code}`}
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'تعدیل موجودی', href: ROUTES.warehouseAdjustments },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {isDraft && canUpdate ? (
              <Button type="button" onClick={() => setSubmitOpen(true)}>
                ارسال برای تأیید
              </Button>
            ) : null}
            {isPendingApproval && canApprove ? (
              <>
                <Button type="button" onClick={() => setApproveOpen(true)}>
                  تأیید
                </Button>
                <Button type="button" variant="outline" onClick={() => setRejectOpen(true)}>
                  رد
                </Button>
              </>
            ) : null}
            {isApproved && canPost ? (
              <Button type="button" onClick={() => setPostOpen(true)}>
                ثبت تعدیل
              </Button>
            ) : null}
            {(isDraft || isPendingApproval) && canCancel ? (
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                لغو
              </Button>
            ) : null}
            <Link
              href={ROUTES.warehouseAdjustments}
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
          <Badge>{inventoryAdjustmentStatusLabel(row.status)}</Badge>
        </div>
        <div>
          <div className="text-xs text-slate-500">دلیل</div>
          <div className="font-medium">{inventoryAdjustmentReasonLabel(row.reason)}</div>
          {row.reasonText ? <div className="text-xs text-slate-600">{row.reasonText}</div> : null}
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
          <div className="text-xs text-slate-500">تأییدکننده</div>
          <div>{actorDisplayName(row.approvedBy)}</div>
          <div className="text-xs text-slate-500">
            {row.approvedAt ? formatDateTime(row.approvedAt) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ثبت</div>
          <div>{actorDisplayName(row.postedBy)}</div>
          <div className="text-xs text-slate-500">
            {row.postedAt ? formatDateTime(row.postedAt) : '—'}
          </div>
        </div>
        <div className="md:col-span-3">
          <div className="text-xs text-slate-500">یادداشت</div>
          <div className="text-sm">{row.notes ?? '—'}</div>
        </div>
      </div>

      {isPosted ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          این تعدیل ثبت شده است. اقلام و مقادیر دیگر قابل ویرایش نیستند.
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">اقلام</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">مکان</th>
                <th className="px-3 py-2 text-start font-medium">SKU</th>
                <th className="px-3 py-2 text-start font-medium">بچ</th>
                <th className="px-3 py-2 text-start font-medium">طبقه‌بندی</th>
                <th className="px-3 py-2 text-start font-medium">جهت</th>
                <th className="px-3 py-2 text-start font-medium">تعداد</th>
                <th className="px-3 py-2 text-start font-medium">فعلی</th>
                <th className="px-3 py-2 text-start font-medium">تغییر</th>
                <th className="px-3 py-2 text-start font-medium">نتیجه</th>
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
                  <td className="px-3 py-2">{inventoryAdjustmentDirectionLabel(item.direction)}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.currentOnHand ?? '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.signedDelta > 0 ? `+${item.signedDelta}` : item.signedDelta}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.resultOnHand ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={warehouseInventoryPositionMovementsPath({
                        skuId: item.skuId,
                        batchId: item.batchId,
                        warehouseId: row.warehouse.id,
                        locationId: item.location.id,
                      })}
                      className="text-xs underline-offset-2 hover:underline"
                    >
                      دفتر حرکات
                    </Link>
                  </td>
                  {isDraft && canUpdate ? (
                    <td className="px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
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
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title="ارسال برای تأیید"
        description="پس از ارسال، ویرایش اقلام تا زمان رد یا لغو محدود می‌شود."
        confirmLabel="ارسال"
        loading={submitMutation.isPending}
        onConfirm={() => submitMutation.mutate()}
      />
      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="تأیید تعدیل"
        description="تعدیل برای ثبت نهایی آماده می‌شود."
        confirmLabel="تأیید"
        loading={approveMutation.isPending}
        onConfirm={() => approveMutation.mutate()}
      />
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="رد تعدیل"
        description="تعدیل رد می‌شود و برای ویرایش به پیش‌نویس برنمی‌گردد."
        confirmLabel="رد"
        danger
        loading={rejectMutation.isPending}
        onConfirm={() => rejectMutation.mutate()}
      />
      <ConfirmDialog
        open={postOpen}
        onOpenChange={setPostOpen}
        title="ثبت تعدیل"
        description="این عملیات موجودی را از طریق ADJUSTMENT_IN/OUT به‌روز می‌کند."
        confirmLabel="ثبت"
        danger
        loading={postMutation.isPending}
        onConfirm={() => postMutation.mutate()}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="لغو تعدیل"
        description="تعدیل بدون اثر موجودی لغو می‌شود."
        confirmLabel="لغو"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
      />

      <WarehouseEntityActivity
        kind="INVENTORY_ADJUSTMENT"
        entityId={adjustmentId}
        readPermission={PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ}
      />
    </div>
  );
}
