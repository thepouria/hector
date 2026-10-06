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
import { StockCountScannerPanel } from '@/features/warehouse/stock-count-scanner-panel';
import {
  actorDisplayName,
  stockClassificationLabel,
  stockCountDifferenceDisplay,
  stockCountLineStatusLabel,
  stockCountStatusLabel,
  stockCountTypeLabel,
} from '@/features/warehouse/stock-count-labels';
import { WarehouseEntityActivity } from '@/features/warehouse/warehouse-entity-activity';
import {
  approveStockCount,
  cancelStockCount,
  fetchStockCount,
  fetchStockCountReview,
  postStockCount,
  rejectStockCount,
  requestStockCountRecount,
  startStockCount,
  submitStockCount,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { StockCountDetail } from '@/types/stock-count';

export function CountDetailPageClient({ countId }: { countId: string }) {
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.WAREHOUSE_COUNT_CREATE);
  const canPerform = can(PERMISSIONS.WAREHOUSE_COUNT_PERFORM);
  const canSubmit = can(PERMISSIONS.WAREHOUSE_COUNT_SUBMIT);
  const canApprove = can(PERMISSIONS.WAREHOUSE_COUNT_APPROVE);
  const canPost = can(PERMISSIONS.WAREHOUSE_COUNT_POST);
  const canCancel = can(PERMISSIONS.WAREHOUSE_COUNT_CANCEL);

  const [activeLocationId, setActiveLocationId] = React.useState<string | null>(null);
  const [startOpen, setStartOpen] = React.useState(false);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [postOpen, setPostOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [recountOpen, setRecountOpen] = React.useState(false);

  const query = useQuery({
    queryKey: warehouseKeys.counts.detail(companyId, countId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_COUNT_READ),
    queryFn: () => fetchStockCount(companyId, countId),
  });

  const row = query.data;
  const showReview =
    row &&
    (row.status === 'SUBMITTED' ||
      row.status === 'APPROVED' ||
      row.status === 'POSTED' ||
      row.status === 'RECOUNT_REQUIRED');

  const reviewQuery = useQuery({
    queryKey: warehouseKeys.counts.review(companyId, countId),
    enabled: Boolean(companyId) && Boolean(showReview) && can(PERMISSIONS.WAREHOUSE_COUNT_READ),
    queryFn: () => fetchStockCountReview(companyId, countId),
  });

  React.useEffect(() => {
    if (!row) return;
    if (activeLocationId && row.items.some((i) => i.location.id === activeLocationId)) return;
    const pending = row.items.find(
      (i) => i.lineStatus === 'PENDING' || i.lineStatus === 'RECOUNT_REQUIRED',
    );
    setActiveLocationId(pending?.location.id ?? row.items[0]?.location.id ?? null);
  }, [row?.id, row?.updatedAt, row?.items, activeLocationId, row]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.counts.all(companyId) });
    await queryClient.invalidateQueries({
      queryKey: warehouseKeys.counts.review(companyId, countId),
    });
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.inventory.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: warehouseKeys.dashboard(companyId) });
  };

  const onCountUpdated = (updated: StockCountDetail) => {
    queryClient.setQueryData(warehouseKeys.counts.detail(companyId, countId), updated);
  };

  const startMutation = useMutation({
    mutationFn: () => startStockCount(companyId, countId),
    onSuccess: async (data) => {
      toast.success('شمارش شروع شد.');
      onCountUpdated(data);
      setStartOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const submitMutation = useMutation({
    mutationFn: () => submitStockCount(companyId, countId),
    onSuccess: async (data) => {
      toast.success('شمارش ارسال شد.');
      onCountUpdated(data);
      setSubmitOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveStockCount(companyId, countId),
    onSuccess: async (data) => {
      toast.success('شمارش تأیید شد.');
      onCountUpdated(data);
      setApproveOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectStockCount(companyId, countId),
    onSuccess: async (data) => {
      toast.success('شمارش رد شد.');
      onCountUpdated(data);
      setRejectOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const recountMutation = useMutation({
    mutationFn: () => requestStockCountRecount(companyId, countId, {}),
    onSuccess: async (data) => {
      toast.success('درخواست شمارش مجدد ثبت شد.');
      onCountUpdated(data);
      setRecountOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const postMutation = useMutation({
    mutationFn: () => postStockCount(companyId, countId),
    onSuccess: async (data) => {
      toast.success('شمارش ثبت شد و موجودی اصلاح شد.');
      onCountUpdated(data);
      setPostOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelStockCount(companyId, countId),
    onSuccess: async (data) => {
      toast.success('شمارش لغو شد.');
      onCountUpdated(data);
      setCancelOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.WAREHOUSE_COUNT_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError) {
    return <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!row) return <ErrorState message="شمارش یافت نشد." />;

  const isDraft = row.status === 'DRAFT';
  const isCounting = row.status === 'IN_PROGRESS' || row.status === 'RECOUNT_REQUIRED';
  const isSubmitted = row.status === 'SUBMITTED';
  const isApproved = row.status === 'APPROVED';
  const isPosted = row.status === 'POSTED';
  const showScanner = isCounting && canPerform;
  const review = reviewQuery.data;
  const approveDescription = review
    ? `پس از تأیید، مجموع واحدهای مثبت: +${review.summary.totalPositiveUnits} و منفی: ${review.summary.totalNegativeUnits} به موجودی اعمال خواهد شد (پس از ثبت).`
    : 'شمارش برای ثبت نهایی آماده می‌شود.';

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description={`${stockCountTypeLabel(row.type)} · ${row.warehouse.code}`}
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'شمارش موجودی', href: ROUTES.warehouseCounts },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {isDraft && canCreate ? (
              <Button type="button" onClick={() => setStartOpen(true)}>
                شروع شمارش
              </Button>
            ) : null}
            {isCounting && canSubmit ? (
              <Button type="button" onClick={() => setSubmitOpen(true)}>
                ارسال برای بررسی
              </Button>
            ) : null}
            {isSubmitted && canApprove ? (
              <>
                <Button type="button" onClick={() => setApproveOpen(true)}>
                  تأیید
                </Button>
                <Button type="button" variant="outline" onClick={() => setRejectOpen(true)}>
                  رد
                </Button>
                <Button type="button" variant="outline" onClick={() => setRecountOpen(true)}>
                  درخواست شمارش مجدد
                </Button>
              </>
            ) : null}
            {isApproved && canPost ? (
              <Button type="button" onClick={() => setPostOpen(true)}>
                ثبت اصلاح موجودی
              </Button>
            ) : null}
            {!isPosted && canCancel ? (
              <Button type="button" variant="outline" onClick={() => setCancelOpen(true)}>
                لغو
              </Button>
            ) : null}
            <Link href={ROUTES.warehouseCounts} className={cn(buttonVariants({ variant: 'ghost' }))}>
              بازگشت
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
        <div>
          <div className="text-xs text-slate-500">وضعیت</div>
          <Badge>{stockCountStatusLabel(row.status)}</Badge>
        </div>
        <div>
          <div className="text-xs text-slate-500">انبار</div>
          <div className="font-mono text-sm" dir="ltr">
            {row.warehouse.code}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">تنظیمات</div>
          <div className="text-sm">
            {row.blindCount ? 'شمارش کور · ' : ''}
            {row.allowDiscoveredItems ? 'قلم کشف‌شده مجاز' : 'بدون کشف'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ایجادکننده</div>
          <div>{actorDisplayName(row.createdBy)}</div>
          <div className="text-xs text-slate-500">{formatDateTime(row.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">شروع</div>
          <div className="text-xs text-slate-600">
            {row.startedAt ? formatDateTime(row.startedAt) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ارسال / ثبت</div>
          <div className="text-xs text-slate-600">
            {row.submittedAt ? formatDateTime(row.submittedAt) : '—'} /{' '}
            {row.postedAt ? formatDateTime(row.postedAt) : '—'}
          </div>
        </div>
      </div>

      {isPosted ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          این شمارش ثبت شده است. خطوط و اختلاف‌ها دیگر قابل تغییر نیستند.
        </div>
      ) : null}

      {showScanner ? (
        <StockCountScannerPanel
          companyId={companyId}
          countId={countId}
          count={row}
          activeLocationId={activeLocationId}
          onCountUpdated={onCountUpdated}
          onActiveLocationChange={setActiveLocationId}
        />
      ) : null}

      {showReview ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">بررسی اختلاف‌ها</h2>
          {reviewQuery.isPending ? (
            <p className="text-sm text-slate-500">در حال بارگذاری بررسی…</p>
          ) : reviewQuery.isError ? (
            <ErrorState
              message={mapBusinessError(reviewQuery.error)}
              onRetry={() => reviewQuery.refetch()}
            />
          ) : review ? (
            <>
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
                <div>
                  <div className="text-xs text-slate-500">مطابق (MATCH)</div>
                  <div className="text-xl tabular-nums" dir="ltr">
                    {review.summary.exactMatches}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">واحد مثبت</div>
                  <div className="text-xl tabular-nums text-emerald-700" dir="ltr">
                    +{review.summary.totalPositiveUnits}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">واحد منفی</div>
                  <div className="text-xl tabular-nums text-red-700" dir="ltr">
                    {review.summary.totalNegativeUnits}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">هشدار اختلاف بالا</div>
                  <div className="text-xl tabular-nums" dir="ltr">
                    {review.summary.highDifferenceWarnings}
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">مکان</th>
                      <th className="px-3 py-2 text-start font-medium">SKU</th>
                      <th className="px-3 py-2 text-start font-medium">بچ</th>
                      <th className="px-3 py-2 text-start font-medium">Snapshot</th>
                      <th className="px-3 py-2 text-start font-medium">حرکت در شمارش</th>
                      <th className="px-3 py-2 text-start font-medium">Expected</th>
                      <th className="px-3 py-2 text-start font-medium">Counted</th>
                      <th className="px-3 py-2 text-start font-medium">Difference</th>
                      <th className="px-3 py-2 text-start font-medium">خط</th>
                    </tr>
                  </thead>
                  <tbody>
                    {review.count.items.map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                          {item.location.code}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                          {item.skuCode}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                          {item.batchNumber}
                        </td>
                        <td className="px-3 py-2 tabular-nums" dir="ltr">
                          {row.blindCount && !isPosted ? '—' : (item.snapshotQuantity ?? '—')}
                        </td>
                        <td className="px-3 py-2 tabular-nums" dir="ltr">
                          {item.movementsDuringCount ?? '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums" dir="ltr">
                          {item.expectedQuantity ?? '—'}
                        </td>
                        <td className="px-3 py-2 tabular-nums" dir="ltr">
                          {item.countedQuantity ?? '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                          {stockCountDifferenceDisplay(item.difference, item.differenceLabel)}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {stockCountLineStatusLabel(item.lineStatus)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">ردیف‌های شمارش</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">مکان</th>
                <th className="px-3 py-2 text-start font-medium">SKU</th>
                <th className="px-3 py-2 text-start font-medium">طبقه‌بندی</th>
                <th className="px-3 py-2 text-start font-medium">Counted</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت خط</th>
              </tr>
            </thead>
            <tbody>
              {row.items.slice(0, 100).map((item) => (
                <tr
                  key={item.id}
                  className={cn(
                    'cursor-pointer border-t border-slate-100 hover:bg-slate-50',
                    item.location.id === activeLocationId && 'bg-sky-50',
                  )}
                  onClick={() => setActiveLocationId(item.location.id)}
                >
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {item.location.code}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {item.skuCode}
                  </td>
                  <td className="px-3 py-2">{stockClassificationLabel(item.classification)}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.countedQuantity ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {stockCountLineStatusLabel(item.lineStatus)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {row.items.length > 100 ? (
            <p className="px-3 py-2 text-xs text-slate-500">نمایش ۱۰۰ ردیف اول از {row.items.length}</p>
          ) : null}
        </div>
      </section>

      <ConfirmDialog
        open={startOpen}
        onOpenChange={setStartOpen}
        title="شروع شمارش"
        description="ردیف‌ها از موجودی فعلی (Snapshot) ساخته می‌شوند."
        confirmLabel="شروع"
        loading={startMutation.isPending}
        onConfirm={() => startMutation.mutate()}
      />
      <ConfirmDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        title="ارسال برای بررسی"
        description="پس از ارسال، شمارش در محیط اسکن بسته می‌شود مگر شمارش مجدد درخواست شود."
        confirmLabel="ارسال"
        loading={submitMutation.isPending}
        onConfirm={() => submitMutation.mutate()}
      />
      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="تأیید شمارش"
        description={approveDescription}
        confirmLabel="تأیید"
        loading={approveMutation.isPending}
        onConfirm={() => approveMutation.mutate()}
      />
      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="رد شمارش"
        description="شمارش رد می‌شود."
        confirmLabel="رد"
        danger
        loading={rejectMutation.isPending}
        onConfirm={() => rejectMutation.mutate()}
      />
      <ConfirmDialog
        open={recountOpen}
        onOpenChange={setRecountOpen}
        title="درخواست شمارش مجدد"
        description="شمارش به حالت شمارش مجدد برمی‌گردد."
        confirmLabel="ارسال"
        loading={recountMutation.isPending}
        onConfirm={() => recountMutation.mutate()}
      />
      <ConfirmDialog
        open={postOpen}
        onOpenChange={setPostOpen}
        title="ثبت اصلاح موجودی"
        description="اختلاف‌های تأیید‌شده از طریق STOCK_COUNT_ADJUSTMENT اعمال می‌شوند."
        confirmLabel="ثبت"
        danger
        loading={postMutation.isPending}
        onConfirm={() => postMutation.mutate()}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="لغو شمارش"
        description="شمارش بدون اثر موجودی لغو می‌شود."
        confirmLabel="لغو"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
      />

      <WarehouseEntityActivity
        kind="STOCK_COUNT"
        entityId={countId}
        readPermission={PERMISSIONS.WAREHOUSE_COUNT_READ}
      />
    </div>
  );
}
