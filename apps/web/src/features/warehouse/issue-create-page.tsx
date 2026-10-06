'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { stockClassificationLabel } from '@/features/warehouse/stock-issue-labels';
import {
  createStockIssue,
  fetchInventoryAvailability,
  fetchInventoryBalances,
  fetchWarehouseLocations,
  fetchWarehouses,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { ROUTES, warehouseIssuePath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { StockClassification } from '@/types/stock-classification';
import type { StockIssueItemInput, StockIssueReason } from '@/types/stock-issue';

type LineDraft = StockIssueItemInput & {
  key: string;
  skuCode: string;
  productName: string | null;
  batchNumber: string;
  onHand: number;
};

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

export function IssueCreatePageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.WAREHOUSE_ISSUE_CREATE);

  const [warehouseId, setWarehouseId] = React.useState(searchParams.get('warehouseId') ?? '');
  const [reason, setReason] = React.useState<StockIssueReason>(
    (searchParams.get('reason') as StockIssueReason) || 'SAMPLE',
  );
  const [reasonText, setReasonText] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<LineDraft[]>([]);

  const [locationId, setLocationId] = React.useState(searchParams.get('locationId') ?? '');
  const [balanceKey, setBalanceKey] = React.useState('');
  const [classification, setClassification] = React.useState<StockClassification>(
    (searchParams.get('classification') as StockClassification) || 'SELLABLE',
  );
  const [quantityText, setQuantityText] = React.useState('');

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

  const locationsQuery = useQuery({
    queryKey: warehouseKeys.locations(companyId, warehouseId, {
      status: 'ACTIVE',
      pageSize: 200,
    }),
    enabled: Boolean(companyId) && Boolean(warehouseId) && canCreate,
    queryFn: () =>
      fetchWarehouseLocations(companyId, warehouseId, {
        status: 'ACTIVE',
        pageSize: 200,
        sortBy: 'code',
        sortOrder: 'asc',
      }),
  });

  const balancesQuery = useQuery({
    queryKey: warehouseKeys.inventory.balances(companyId, {
      warehouseId,
      locationId,
      classification,
      pageSize: 100,
    }),
    enabled: Boolean(companyId) && Boolean(warehouseId) && Boolean(locationId) && canCreate,
    queryFn: () =>
      fetchInventoryBalances(companyId, {
        warehouseId,
        locationId,
        classification,
        pageSize: 100,
      }),
  });

  const warehouses = warehousesQuery.data?.data ?? [];
  const locations = locationsQuery.data?.data ?? [];
  const balances = (balancesQuery.data?.data ?? []).filter((b) => b.onHandQuantity > 0);
  const selectedBalance = balances.find(
    (b) => `${b.skuId}:${b.batchId}:${b.classification}` === balanceKey,
  );

  const availabilityQuery = useQuery({
    queryKey: [
      ...warehouseKeys.all(companyId),
      'availability',
      warehouseId,
      selectedBalance?.skuId,
    ] as const,
    enabled:
      Boolean(companyId) &&
      Boolean(warehouseId) &&
      Boolean(selectedBalance?.skuId) &&
      classification === 'SELLABLE' &&
      canCreate,
    queryFn: () =>
      fetchInventoryAvailability(companyId, warehouseId, selectedBalance!.skuId),
  });

  React.useEffect(() => {
    if (!searchParams.get('locationId')) setLocationId('');
    setBalanceKey('');
  }, [warehouseId, searchParams]);

  React.useEffect(() => {
    setBalanceKey('');
  }, [locationId, classification]);

  const addLine = () => {
    if (!warehouseId || !locationId || !balanceKey) {
      toast.error('انبار، مکان و موقعیت موجودی را کامل کنید.');
      return;
    }
    const quantity = Number.parseInt(quantityText, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast.error('تعداد باید عدد مثبت باشد.');
      return;
    }
    const balance = balances.find((b) => `${b.skuId}:${b.batchId}:${b.classification}` === balanceKey);
    if (!balance) {
      toast.error('موقعیت موجودی یافت نشد.');
      return;
    }
    if (quantity > balance.onHandQuantity) {
      toast.error('تعداد بیش از موجودی منبع است.');
      return;
    }
    if (
      classification === 'SELLABLE' &&
      availabilityQuery.data &&
      quantity > availabilityQuery.data.available
    ) {
      toast.error(
        `موجودی رزروشده محافظت می‌شود. Available=${availabilityQuery.data.available}، درخواست=${quantity}.`,
      );
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        key: `${Date.now()}-${prev.length}`,
        skuId: balance.skuId,
        batchId: balance.batchId,
        locationId,
        classification: balance.classification,
        quantity,
        skuCode: balance.skuCode,
        productName: balance.productName,
        batchNumber: balance.batchNumber,
        onHand: balance.onHandQuantity,
      },
    ]);
    setQuantityText('');
    setBalanceKey('');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createStockIssue(companyId, {
        warehouseId,
        reason,
        reasonText: reasonText.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines.map(({ skuId, batchId, locationId, classification, quantity }) => ({
          skuId,
          batchId,
          locationId,
          classification,
          quantity,
        })),
      }),
    onSuccess: (data) => {
      toast.success('پیش‌نویس خروج ایجاد شد.');
      router.push(warehouseIssuePath(data.id));
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!canCreate) return <AccessDenied />;
  if (warehousesQuery.isPending) return <PageSkeleton />;

  const needsReasonText = reason === 'MANUAL' || reason === 'OTHER';

  return (
    <div className="space-y-6">
      <PageHeader
        title="خروج جدید"
        description="پیش‌نویس خروج موجودی را ایجاد کنید. تا قبل از ثبت، موجودی شرکت کم نمی‌شود."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'خروج غیرفروشی', href: ROUTES.warehouseIssues },
          { label: 'جدید' },
        ]}
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="issue-wh">انبار</Label>
          <select
            id="issue-wh"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            <option value="">انتخاب انبار</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} — {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="issue-reason">دلیل</Label>
          <select
            id="issue-reason"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value as StockIssueReason)}
          >
            <option value="SAMPLE">نمونه</option>
            <option value="COMPANY_USE">مصرف داخلی</option>
            <option value="DAMAGE">امحا / آسیب فیزیکی</option>
            <option value="MANUAL">دستی</option>
            <option value="OTHER">سایر</option>
          </select>
        </div>
        {needsReasonText ? (
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="issue-reason-text">توضیح دلیل (الزامی)</Label>
            <Input
              id="issue-reason-text"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="issue-notes">یادداشت</Label>
          <textarea
            id="issue-notes"
            className={textareaClassName}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold">افزودن قلم</h2>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>مکان</Label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              disabled={!warehouseId}
            >
              <option value="">انتخاب مکان</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>طبقه‌بندی منبع</Label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={classification}
              onChange={(e) => setClassification(e.target.value as StockClassification)}
            >
              <option value="SELLABLE">قابل فروش</option>
              <option value="TESTER">تستر</option>
              <option value="DAMAGED">آسیب‌دیده</option>
              <option value="QUARANTINE">قرنطینه</option>
            </select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label>SKU / بچ (موجودی منبع)</Label>
            <select
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={balanceKey}
              onChange={(e) => setBalanceKey(e.target.value)}
              disabled={!locationId}
            >
              <option value="">انتخاب موقعیت</option>
              {balances.map((b) => (
                <option
                  key={`${b.skuId}:${b.batchId}:${b.classification}`}
                  value={`${b.skuId}:${b.batchId}:${b.classification}`}
                >
                  {b.skuCode} · {b.batchNumber} · {stockClassificationLabel(b.classification)} · On
                  Hand {b.onHandQuantity}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>تعداد</Label>
            <Input
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div className="flex items-end">
            <Button type="button" variant="outline" onClick={addLine}>
              افزودن قلم
            </Button>
          </div>
        </div>

        {selectedBalance ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="font-medium text-slate-800">موقعیت انتخاب‌شده</div>
            <div className="mt-1 grid gap-2 sm:grid-cols-3" dir="ltr">
              <div>
                On Hand:{' '}
                <span className="font-semibold tabular-nums">{selectedBalance.onHandQuantity}</span>
              </div>
              {classification === 'SELLABLE' && availabilityQuery.data ? (
                <>
                  <div>
                    Reserved:{' '}
                    <span className="font-semibold tabular-nums">
                      {availabilityQuery.data.reserved}
                    </span>
                  </div>
                  <div>
                    Available:{' '}
                    <span className="font-semibold tabular-nums">
                      {availabilityQuery.data.available}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {lines.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-100">
            {lines.map((line) => (
              <li key={line.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div>
                  <div className="font-mono text-xs" dir="ltr">
                    {line.skuCode} · {line.batchNumber}
                  </div>
                  <div className="text-xs text-slate-600">
                    {stockClassificationLabel(line.classification)} · qty {line.quantity}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                >
                  حذف
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(ROUTES.warehouseIssues)}
        >
          انصراف
        </Button>
        <Button
          type="button"
          disabled={
            !warehouseId ||
            lines.length === 0 ||
            (needsReasonText && !reasonText.trim()) ||
            createMutation.isPending
          }
          onClick={() => createMutation.mutate()}
        >
          ایجاد پیش‌نویس
        </Button>
      </div>
    </div>
  );
}
