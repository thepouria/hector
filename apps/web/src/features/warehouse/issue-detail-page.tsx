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
import { IssueScannerPanel } from '@/features/warehouse/issue-scanner-panel';
import {
  actorDisplayName,
  stockClassificationLabel,
  stockIssueReasonLabel,
  stockIssueStatusLabel,
} from '@/features/warehouse/stock-issue-labels';
import { WarehouseEntityActivity } from '@/features/warehouse/warehouse-entity-activity';
import {
  cancelStockIssue,
  fetchStockIssue,
  postStockIssue,
  removeStockIssueItem,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, warehouseInventoryPositionMovementsPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function IssueDetailPageClient({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canUpdate = can(PERMISSIONS.WAREHOUSE_ISSUE_UPDATE);
  const canPost = can(PERMISSIONS.WAREHOUSE_ISSUE_POST);
  const canCancel = can(PERMISSIONS.WAREHOUSE_ISSUE_CANCEL);

  const [postOpen, setPostOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const query = useQuery({
    queryKey: warehouseKeys.issues.detail(companyId, issueId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_ISSUE_READ),
    queryFn: () => fetchStockIssue(companyId, issueId),
  });

  const row = query.data;
  const isDraft = row?.status === 'DRAFT';

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.issues.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.inventory.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.dashboard(companyId) });
  };

  const postMutation = useMutation({
    mutationFn: () => postStockIssue(companyId, issueId),
    onSuccess: async () => {
      toast.success('خروج ثبت شد و موجودی شرکت کاهش یافت.');
      setPostOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelStockIssue(companyId, issueId),
    onSuccess: async () => {
      toast.success('پیش‌نویس لغو شد.');
      setCancelOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removeStockIssueItem(companyId, issueId, itemId),
    onSuccess: async () => {
      toast.success('قلم حذف شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_ISSUE_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError) {
    return <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!row) return <ErrorState message="خروج یافت نشد." />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description={`${stockIssueReasonLabel(row.reason)} · ${row.warehouse.code}`}
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'خروج غیرفروشی', href: ROUTES.warehouseIssues },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {isDraft && canPost ? (
              <Button type="button" onClick={() => setPostOpen(true)}>
                ثبت خروج
              </Button>
            ) : null}
            {isDraft && canCancel ? (
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                لغو پیش‌نویس
              </Button>
            ) : null}
            <Link href={ROUTES.warehouseIssues} className={cn(buttonVariants({ variant: 'ghost' }))}>
              بازگشت
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
        <div>
          <div className="text-xs text-slate-500">وضعیت</div>
          <Badge>{stockIssueStatusLabel(row.status)}</Badge>
        </div>
        <div>
          <div className="text-xs text-slate-500">دلیل</div>
          <div className="font-medium">{stockIssueReasonLabel(row.reason)}</div>
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
          <div className="text-xs text-slate-500">ثبت‌کننده</div>
          <div>{actorDisplayName(row.postedBy)}</div>
          <div className="text-xs text-slate-500">
            {row.postedAt ? formatDateTime(row.postedAt) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">یادداشت</div>
          <div className="text-sm">{row.notes ?? '—'}</div>
        </div>
      </div>

      {row.status === 'POSTED' ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          این خروج ثبت شده است. موجودی از شرکت خارج شده و لغو مستقیم مجاز نیست.
        </div>
      ) : null}

      {isDraft && canUpdate ? (
        <IssueScannerPanel
          companyId={companyId}
          issueId={issueId}
          issue={row}
          onIssueUpdated={(next) => {
            queryClient.setQueryData(warehouseKeys.issues.detail(companyId, issueId), next);
          }}
        />
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
                  <td className="px-3 py-2">
                    {stockClassificationLabel(item.classification)}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.sourceOnHand ?? '—'}
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
        open={postOpen}
        onOpenChange={setPostOpen}
        title="ثبت خروج موجودی"
        description="این عملیات موجودی را از موجودی شرکت خارج می‌کند. سفارش فروش یا درآمد ایجاد نمی‌شود."
        confirmLabel="ثبت خروج"
        danger
        loading={postMutation.isPending}
        onConfirm={() => postMutation.mutate()}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="لغو پیش‌نویس"
        description="پیش‌نویس بدون اثر موجودی لغو می‌شود."
        confirmLabel="لغو"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
      />

      <WarehouseEntityActivity
        kind="STOCK_ISSUE"
        entityId={issueId}
        readPermission={PERMISSIONS.WAREHOUSE_ISSUE_READ}
      />
    </div>
  );
}
