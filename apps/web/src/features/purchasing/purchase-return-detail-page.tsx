'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  purchaseReturnReasonLabel,
  purchaseReturnStatusLabel,
} from '@/features/purchasing/purchase-order-labels';
import {
  approvePurchaseReturn,
  cancelPurchaseReturn,
  fetchPurchaseReturn,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { purchaseReturnKeys, purchasingKeys } from '@/lib/query/keys';
import { ROUTES, purchasingOrderPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

export function PurchaseReturnDetailPage({ purchaseReturnId }: { purchaseReturnId: string }) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');

  const query = useQuery({
    queryKey: purchaseReturnKeys.detail(companyId, purchaseReturnId),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchPurchaseReturn(companyId, purchaseReturnId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: purchaseReturnKeys.detail(companyId, purchaseReturnId),
    });
    await queryClient.invalidateQueries({ queryKey: purchaseReturnKeys.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: purchasingKeys.summary(companyId) });
  };

  const approve = useMutation({
    mutationFn: () => approvePurchaseReturn(companyId, purchaseReturnId),
    onSuccess: async () => {
      toast.success('برگشت تأیید شد (نیت تجاری — بدون خروج انبار).');
      setApproveOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancel = useMutation({
    mutationFn: () => {
      if (!cancelReason.trim()) throw new Error('reason');
      return cancelPurchaseReturn(companyId, purchaseReturnId, cancelReason.trim());
    },
    onSuccess: async () => {
      toast.success('برگشت لغو شد.');
      setCancelOpen(false);
      setCancelReason('');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'reason') {
        toast.error('دلیل لغو الزامی است.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  if (!can(PERMISSIONS.PURCHASING_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError || !query.data) {
    return (
      <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
    );
  }

  const row = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description="برگشت به تأمین‌کننده"
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'برگشت‌ها', href: ROUTES.purchasingReturns },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge>{purchaseReturnStatusLabel(row.status)}</Badge>
            {row.status === 'DRAFT' && can(PERMISSIONS.PURCHASING_RETURN_APPROVE) ? (
              <Button type="button" onClick={() => setApproveOpen(true)}>
                تأیید برگشت
              </Button>
            ) : null}
            {(row.status === 'DRAFT' || row.status === 'APPROVED') &&
            can(PERMISSIONS.PURCHASING_RETURN_CANCEL) ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  setCancelReason('');
                  setCancelOpen(true);
                }}
              >
                لغو برگشت
              </Button>
            ) : null}
          </div>
        }
      />

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        اجرای فیزیکی برگشت انبار در ماژول انبار انجام می‌شود. تسویه مالی (بستانکاری / بازپرداخت) در
        مالی آینده است. این صفحه هیچ‌یک را اجرا نمی‌کند.
      </p>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <div className="text-xs text-slate-500">وضعیت</div>
          <div className="mt-1">
            <Badge>{purchaseReturnStatusLabel(row.status)}</Badge>
            <span className="ms-2 font-mono text-[10px] text-slate-400" dir="ltr">
              {row.status}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">دلیل</div>
          <div className="mt-1 text-sm">{purchaseReturnReasonLabel(row.reason)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">تأمین‌کننده</div>
          <div className="mt-1 text-sm">{row.supplier.name}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">سفارش خرید</div>
          <div className="mt-1 text-sm">
            {row.purchaseOrder ? (
              <Link
                href={purchasingOrderPath(row.purchaseOrder.id)}
                className="underline-offset-2 hover:underline"
              >
                {row.purchaseOrder.number}
              </Link>
            ) : (
              '—'
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ایجاد</div>
          <div className="mt-1 text-sm">
            {row.createdBy.displayName} · {formatDateTime(row.createdAt)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">تأیید</div>
          <div className="mt-1 text-sm">
            {row.approvedBy
              ? `${row.approvedBy.displayName} · ${formatDateTime(row.approvedAt)}`
              : '—'}
          </div>
        </div>
        {row.notes ? (
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500">یادداشت</div>
            <div className="mt-1 text-sm whitespace-pre-wrap">{row.notes}</div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">اقلام</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="py-1 text-start font-medium">SKU</th>
                <th className="py-1 text-start font-medium">محصول</th>
                <th className="py-1 text-start font-medium">تعداد</th>
                <th className="py-1 text-start font-medium">دلیل</th>
              </tr>
            </thead>
            <tbody>
              {row.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="py-2 font-mono" dir="ltr">
                    {item.sku.code}
                  </td>
                  <td className="py-2">{item.sku.product.name ?? item.sku.name ?? '—'}</td>
                  <td className="py-2 tabular-nums" dir="ltr">
                    {item.quantity}
                  </td>
                  <td className="py-2">
                    {item.reason ? purchaseReturnReasonLabel(item.reason) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="تأیید برگشت"
        description="تأیید فقط نیت تجاری را ثبت می‌کند. موجودی کم نمی‌شود، پرداخت تغییر نمی‌کند، و خروج فیزیکی از انبار انجام نمی‌شود."
        target={row.number}
        confirmLabel="تأیید برگشت"
        loading={approve.isPending}
        onConfirm={() => approve.mutate()}
      />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="لغو برگشت">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">لغو برگشت برنامه‌ریزی‌شده — بدون اثر انبار یا مالی.</p>
          <div className="space-y-1">
            <Label htmlFor="cancel-return-reason">دلیل لغو</Label>
            <textarea
              id="cancel-return-reason"
              className={textareaClassName}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              لغو برگشت
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
