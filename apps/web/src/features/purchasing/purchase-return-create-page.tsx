'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  purchaseReturnReasonLabel,
} from '@/features/purchasing/purchase-order-labels';
import {
  createPurchaseReturn,
  fetchPurchaseOrder,
  fetchPurchaseOrders,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { purchaseOrderKeys, purchaseReturnKeys, purchasingKeys } from '@/lib/query/keys';
import { ROUTES, purchasingReturnPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type {
  PurchaseReturnReason,
  PurchaseReturnResolution,
} from '@/types/purchasing';

const REASONS: PurchaseReturnReason[] = [
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'OVER_SHIPMENT',
  'QUALITY_ISSUE',
  'EXPIRED',
  'SUPPLIER_AGREEMENT',
  'OTHER',
];

const RESOLUTIONS: Array<{ value: PurchaseReturnResolution; label: string }> = [
  { value: 'UNKNOWN', label: 'نامشخص (فعلاً)' },
  { value: 'REFUND', label: 'بازپرداخت (مالی آینده)' },
  { value: 'SUPPLIER_CREDIT', label: 'بستانکاری تأمین‌کننده (مالی آینده)' },
  { value: 'REPLACEMENT', label: 'تعویض کالا' },
  { value: 'PAYABLE_REDUCTION', label: 'کاهش بدهی (مالی آینده)' },
];

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

type LineDraft = {
  purchaseOrderItemId: string;
  selected: boolean;
  quantity: string;
  reason: PurchaseReturnReason | '';
  notes: string;
};

export function PurchaseReturnCreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.PURCHASING_RETURN_CREATE);

  const initialPoId = searchParams.get('purchaseOrderId') ?? '';

  const [poSearch, setPoSearch] = React.useState('');
  const [debouncedPoSearch, setDebouncedPoSearch] = React.useState('');
  const [purchaseOrderId, setPurchaseOrderId] = React.useState(initialPoId);
  const [reason, setReason] = React.useState<PurchaseReturnReason>('DAMAGED');
  const [expectedResolution, setExpectedResolution] =
    React.useState<PurchaseReturnResolution>('UNKNOWN');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<LineDraft[]>([]);

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedPoSearch(poSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [poSearch]);

  const poListQuery = useQuery({
    queryKey: purchaseOrderKeys.list(companyId, {
      search: debouncedPoSearch || undefined,
      pageSize: '20',
      forReturn: '1',
    }),
    enabled: Boolean(companyId) && canCreate,
    queryFn: () =>
      fetchPurchaseOrders(companyId, {
        search: debouncedPoSearch || undefined,
        pageSize: '20',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      }),
  });

  const poDetailQuery = useQuery({
    queryKey: purchaseOrderKeys.detail(companyId, purchaseOrderId),
    enabled: Boolean(companyId) && Boolean(purchaseOrderId) && canCreate,
    queryFn: () => fetchPurchaseOrder(companyId, purchaseOrderId),
  });

  React.useEffect(() => {
    const po = poDetailQuery.data;
    if (!po) {
      setLines([]);
      return;
    }
    setLines(
      po.items.map((item) => ({
        purchaseOrderItemId: item.id,
        selected: false,
        quantity: String(item.quantity),
        reason: '',
        notes: '',
      })),
    );
  }, [poDetailQuery.data]);

  const createMutation = useMutation({
    mutationFn: () => {
      if (!purchaseOrderId) throw new Error('po');
      const items = lines
        .filter((line) => line.selected)
        .map((line) => {
          const quantity = Number(line.quantity);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
          return {
            purchaseOrderItemId: line.purchaseOrderItemId,
            quantity,
            reason: line.reason || undefined,
            notes: line.notes.trim() || undefined,
          };
        });
      if (items.length === 0) throw new Error('empty');
      return createPurchaseReturn(companyId, {
        purchaseOrderId,
        reason,
        expectedResolution,
        notes: notes.trim() || undefined,
        items,
      });
    },
    onSuccess: async (row) => {
      toast.success('برگشت به‌صورت پیش‌نویس ثبت شد.');
      await queryClient.invalidateQueries({ queryKey: purchaseReturnKeys.all(companyId) });
      await queryClient.invalidateQueries({ queryKey: purchasingKeys.summary(companyId) });
      router.push(purchasingReturnPath(row.id));
    },
    onError: (error) => {
      if (error instanceof Error) {
        if (error.message === 'po') {
          toast.error('سفارش خرید را انتخاب کنید.');
          return;
        }
        if (error.message === 'empty') {
          toast.error('حداقل یک قلم را انتخاب کنید.');
          return;
        }
        if (error.message === 'quantity') {
          toast.error('تعداد برگشت باید عدد صحیح مثبت باشد.');
          return;
        }
      }
      toast.error(mapBusinessError(error));
    },
  });

  if (!canCreate) return <AccessDenied />;

  const po = poDetailQuery.data;
  const orderedOptions = poListQuery.data?.data ?? [];
  const selectedInList = purchaseOrderId
    ? orderedOptions.some((row) => row.id === purchaseOrderId)
    : true;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ثبت برگشت به تأمین‌کننده"
        description="نیت تجاری برگشت — بدون خروج از انبار"
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'برگشت‌ها', href: ROUTES.purchasingReturns },
          { label: 'ثبت برگشت' },
        ]}
      />

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        ثبت یا تأیید برگشت در این بخش باعث خروج کالا از انبار نمی‌شود. عملیات فیزیکی برگشت در ماژول
        انبار انجام خواهد شد. تسویه مالی نیز در فاز مالی است.
      </p>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <Label htmlFor="return-po-search">جستجوی سفارش خرید (سفارش‌داده‌شده)</Label>
          <Input
            id="return-po-search"
            value={poSearch}
            onChange={(e) => setPoSearch(e.target.value)}
            placeholder="شماره PO یا تأمین‌کننده"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="return-po">سفارش خرید</Label>
          {poListQuery.isPending && !purchaseOrderId ? (
            <p className="text-sm text-slate-500">در حال بارگذاری…</p>
          ) : poListQuery.isError ? (
            <ErrorState
              message={mapBusinessError(poListQuery.error)}
              onRetry={() => poListQuery.refetch()}
            />
          ) : (
            <select
              id="return-po"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={purchaseOrderId}
              onChange={(e) => setPurchaseOrderId(e.target.value)}
            >
              <option value="">انتخاب کنید…</option>
              {!selectedInList && purchaseOrderId && po ? (
                <option value={po.id}>
                  {po.number} — {po.supplier.name}
                </option>
              ) : null}
              {orderedOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.number} — {row.supplier.name}
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-slate-500">
            فهرست پیش‌فرض سفارش‌های ORDERED است؛ می‌توانید از جزئیات سفارش نیز وارد این فرم شوید.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="return-reason">دلیل برگشت</Label>
            <select
              id="return-reason"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value as PurchaseReturnReason)}
            >
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {purchaseReturnReasonLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="return-resolution">انتظار حل‌وفصل</Label>
            <select
              id="return-resolution"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={expectedResolution}
              onChange={(e) =>
                setExpectedResolution(e.target.value as PurchaseReturnResolution)
              }
            >
              {RESOLUTIONS.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="return-notes">یادداشت</Label>
          <textarea
            id="return-notes"
            className={textareaClassName}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">اقلام برگشتی</h2>
        {!purchaseOrderId ? (
          <p className="text-sm text-slate-500">ابتدا سفارش خرید را انتخاب کنید.</p>
        ) : poDetailQuery.isPending ? (
          <PageSkeleton />
        ) : poDetailQuery.isError || !po ? (
          <ErrorState
            message={mapBusinessError(poDetailQuery.error)}
            onRetry={() => poDetailQuery.refetch()}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 text-start font-medium">انتخاب</th>
                  <th className="py-1 text-start font-medium">SKU</th>
                  <th className="py-1 text-start font-medium">محصول</th>
                  <th className="py-1 text-start font-medium">سفارش</th>
                  <th className="py-1 text-start font-medium">تعداد برگشت</th>
                  <th className="py-1 text-start font-medium">دلیل قلم</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((item) => {
                  const line = lines.find((l) => l.purchaseOrderItemId === item.id);
                  if (!line) return null;
                  return (
                    <tr key={item.id} className="border-t border-slate-100 align-top">
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={line.selected}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((row) =>
                                row.purchaseOrderItemId === item.id
                                  ? { ...row, selected: e.target.checked }
                                  : row,
                              ),
                            )
                          }
                          aria-label={`انتخاب ${item.skuCodeSnapshot ?? item.sku.code}`}
                        />
                      </td>
                      <td className="py-2 font-mono" dir="ltr">
                        {item.skuCodeSnapshot ?? item.sku.code}
                      </td>
                      <td className="py-2">
                        {item.productNameSnapshot ?? item.sku.product.name ?? '—'}
                      </td>
                      <td className="py-2 tabular-nums" dir="ltr">
                        {item.quantity}
                      </td>
                      <td className="py-2">
                        <Input
                          dir="ltr"
                          inputMode="numeric"
                          disabled={!line.selected}
                          value={line.quantity}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((row) =>
                                row.purchaseOrderItemId === item.id
                                  ? { ...row, quantity: e.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="py-2">
                        <select
                          className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
                          disabled={!line.selected}
                          value={line.reason}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((row) =>
                                row.purchaseOrderItemId === item.id
                                  ? {
                                      ...row,
                                      reason: e.target.value as PurchaseReturnReason | '',
                                    }
                                  : row,
                              ),
                            )
                          }
                        >
                          <option value="">همان دلیل کلی</option>
                          {REASONS.map((value) => (
                            <option key={value} value={value}>
                              {purchaseReturnReasonLabel(value)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(ROUTES.purchasingReturns)}
        >
          انصراف
        </Button>
        <Button
          type="button"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? 'در حال ثبت…' : 'ذخیره پیش‌نویس برگشت'}
        </Button>
      </div>
    </div>
  );
}
