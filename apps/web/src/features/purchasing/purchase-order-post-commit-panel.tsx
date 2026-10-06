'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import {
  rialsStringToTomanDisplay,
  tomanInputToRialsString,
} from '@/features/purchasing/offer-money';
import {
  purchaseCorrectionTypeLabel,
  purchaseDiscrepancySourceLabel,
  purchaseDiscrepancyTypeLabel,
} from '@/features/purchasing/purchase-order-labels';
import {
  createPurchaseOrderCorrection,
  createPurchaseOrderDiscrepancy,
  fetchPurchaseOrderCorrections,
  fetchPurchaseOrderDiscrepancies,
  shortClosePurchaseOrderItem,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { purchaseOrderKeys, purchasingKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';
import type {
  OfferCurrency,
  PurchaseCorrectionType,
  PurchaseDiscrepancyType,
  PurchaseOrder,
  PurchaseOrderItem,
} from '@/types/purchasing';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

const ITEM_CORRECTION_TYPES: PurchaseCorrectionType[] = [
  'QUANTITY_CORRECTION',
  'PRICE_CORRECTION',
  'DATA_ENTRY_ERROR',
];

const DISCREPANCY_TYPES: PurchaseDiscrepancyType[] = [
  'SHORT_SHIPMENT',
  'OVER_SHIPMENT',
  'DAMAGED',
  'WRONG_ITEM',
  'MISSING',
  'OTHER',
];

function snapshotValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function itemLabel(item: PurchaseOrderItem): string {
  const code = item.skuCodeSnapshot ?? item.sku.code;
  const name =
    item.productNameSnapshot ?? item.sku.product.name ?? item.sku.name ?? code;
  return `${code} — ${name}`;
}

function resolveUnitPrice(currency: OfferCurrency, priceInput: string): string | null {
  if (currency === 'IRR') return tomanInputToRialsString(priceInput);
  const usd = priceInput.trim();
  if (!usd || !/^\d+(\.\d{1,6})?$/.test(usd) || Number(usd) <= 0) return null;
  return usd;
}

type Props = {
  purchaseOrder: PurchaseOrder;
};

export function PurchaseOrderPostCommitPanel({ purchaseOrder }: Props) {
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const poId = purchaseOrder.id;

  const canCorrect = can(PERMISSIONS.PURCHASING_PO_CORRECT);
  const canDiscrepancy = can(PERMISSIONS.PURCHASING_DISCREPANCY_MANAGE);
  const canShortClose = can(PERMISSIONS.PURCHASING_PO_SHORT_CLOSE);

  const isCorrectable =
    purchaseOrder.status === 'APPROVED' || purchaseOrder.status === 'ORDERED';
  const canRecordDiscrepancy =
    purchaseOrder.status === 'ORDERED' ||
    purchaseOrder.status === 'PARTIALLY_RECEIVED' ||
    purchaseOrder.status === 'APPROVED';

  const [correctOpen, setCorrectOpen] = React.useState(false);
  const [discrepancyOpen, setDiscrepancyOpen] = React.useState(false);
  const [shortCloseItem, setShortCloseItem] = React.useState<PurchaseOrderItem | null>(null);

  const [correctionType, setCorrectionType] =
    React.useState<PurchaseCorrectionType>('PRICE_CORRECTION');
  const [correctionItemId, setCorrectionItemId] = React.useState('');
  const [correctionQty, setCorrectionQty] = React.useState('');
  const [correctionPrice, setCorrectionPrice] = React.useState('');
  const [correctionReason, setCorrectionReason] = React.useState('');
  const [confirmCorrect, setConfirmCorrect] = React.useState(false);

  const [discItemId, setDiscItemId] = React.useState('');
  const [discType, setDiscType] = React.useState<PurchaseDiscrepancyType>('SHORT_SHIPMENT');
  const [discQty, setDiscQty] = React.useState('');
  const [discReason, setDiscReason] = React.useState('');
  const [discNotes, setDiscNotes] = React.useState('');

  const [shortQty, setShortQty] = React.useState('');
  const [shortReason, setShortReason] = React.useState('');

  const correctionsQuery = useQuery({
    queryKey: purchaseOrderKeys.corrections(companyId, poId),
    enabled: Boolean(companyId),
    queryFn: () => fetchPurchaseOrderCorrections(companyId, poId),
  });

  const discrepanciesQuery = useQuery({
    queryKey: purchaseOrderKeys.discrepancies(companyId, poId),
    enabled: Boolean(companyId),
    queryFn: () => fetchPurchaseOrderDiscrepancies(companyId, poId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: purchaseOrderKeys.detail(companyId, poId),
    });
    await queryClient.invalidateQueries({
      queryKey: purchaseOrderKeys.corrections(companyId, poId),
    });
    await queryClient.invalidateQueries({
      queryKey: purchaseOrderKeys.discrepancies(companyId, poId),
    });
    await queryClient.invalidateQueries({ queryKey: purchasingKeys.summary(companyId) });
  };

  const selectedCorrectionItem = purchaseOrder.items.find((i) => i.id === correctionItemId);

  const correctionMutation = useMutation({
    mutationFn: () => {
      if (!correctionReason.trim()) throw new Error('reason');
      const body: Parameters<typeof createPurchaseOrderCorrection>[2] = {
        type: correctionType,
        reason: correctionReason.trim(),
        version: purchaseOrder.version,
      };
      if (ITEM_CORRECTION_TYPES.includes(correctionType)) {
        if (!correctionItemId) throw new Error('item');
        body.purchaseOrderItemId = correctionItemId;
        if (
          correctionType === 'QUANTITY_CORRECTION' ||
          (correctionType === 'DATA_ENTRY_ERROR' && correctionQty.trim())
        ) {
          const quantity = Number(correctionQty);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
          body.quantity = quantity;
        }
        if (
          correctionType === 'PRICE_CORRECTION' ||
          (correctionType === 'DATA_ENTRY_ERROR' && correctionPrice.trim())
        ) {
          const unitPrice = resolveUnitPrice(purchaseOrder.currency, correctionPrice);
          if (!unitPrice) throw new Error('price');
          body.unitPrice = unitPrice;
        }
        if (
          correctionType === 'DATA_ENTRY_ERROR' &&
          body.quantity === undefined &&
          body.unitPrice === undefined
        ) {
          throw new Error('data-entry');
        }
      } else {
        throw new Error('unsupported-ui');
      }
      return createPurchaseOrderCorrection(companyId, poId, body);
    },
    onSuccess: async () => {
      toast.success('اصلاح خرید اعمال شد.');
      setConfirmCorrect(false);
      setCorrectOpen(false);
      setCorrectionReason('');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error) {
        if (error.message === 'reason') {
          toast.error('دلیل اصلاح الزامی است.');
          return;
        }
        if (error.message === 'item') {
          toast.error('قلم سفارش را انتخاب کنید.');
          return;
        }
        if (error.message === 'quantity' || error.message === 'price' || error.message === 'data-entry') {
          toast.error('مقادیر اصلاح را به‌درستی وارد کنید.');
          return;
        }
        if (error.message === 'unsupported-ui') {
          toast.error('این نوع اصلاح از این فرم پشتیبانی نمی‌شود.');
          return;
        }
      }
      toast.error(mapBusinessError(error));
    },
  });

  const discrepancyMutation = useMutation({
    mutationFn: () => {
      const quantity = Number(discQty);
      if (!discItemId) throw new Error('item');
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
      if (!discReason.trim()) throw new Error('reason');
      return createPurchaseOrderDiscrepancy(companyId, poId, {
        purchaseOrderItemId: discItemId,
        type: discType,
        source: 'BEFORE_RECEIPT',
        quantity,
        reason: discReason.trim(),
        notes: discNotes.trim() || undefined,
      });
    },
    onSuccess: async () => {
      toast.success('مغایرت ثبت شد (بدون تغییر موجودی).');
      setDiscrepancyOpen(false);
      setDiscReason('');
      setDiscNotes('');
      setDiscQty('');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && ['item', 'quantity', 'reason'].includes(error.message)) {
        toast.error('قلم، تعداد و دلیل مغایرت را تکمیل کنید.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const shortCloseMutation = useMutation({
    mutationFn: () => {
      if (!shortCloseItem) throw new Error('item');
      const quantity = Number(shortQty);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
      if (!shortReason.trim()) throw new Error('reason');
      return shortClosePurchaseOrderItem(companyId, poId, shortCloseItem.id, {
        quantity,
        reason: shortReason.trim(),
        version: purchaseOrder.version,
      });
    },
    onSuccess: async () => {
      toast.success('مقدار تأمین‌نشده بسته شد. تعداد سفارش اصلی تغییر نکرد.');
      setShortCloseItem(null);
      setShortQty('');
      setShortReason('');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && ['item', 'quantity', 'reason'].includes(error.message)) {
        toast.error('تعداد و دلیل بستن کسری را وارد کنید.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const openCorrect = () => {
    const first = purchaseOrder.items[0];
    setCorrectionType('PRICE_CORRECTION');
    setCorrectionItemId(first?.id ?? '');
    setCorrectionQty(first ? String(first.quantity) : '');
    setCorrectionPrice(
      first
        ? purchaseOrder.currency === 'IRR'
          ? rialsStringToTomanDisplay(first.unitPrice)
          : first.unitPrice
        : '',
    );
    setCorrectionReason('');
    setCorrectOpen(true);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">اصلاح‌ها و مغایرت‌ها</h2>
            <p className="mt-1 text-xs text-slate-500">
              اصلاح تجاری با ویرایش پیش‌نویس فرق دارد. مغایرت تأمین، دریافت انبار نیست.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canCorrect && isCorrectable ? (
              <Button type="button" variant="outline" onClick={openCorrect}>
                اصلاح خرید
              </Button>
            ) : null}
            {canDiscrepancy && canRecordDiscrepancy ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDiscItemId(purchaseOrder.items[0]?.id ?? '');
                  setDiscType('SHORT_SHIPMENT');
                  setDiscQty('');
                  setDiscReason('');
                  setDiscNotes('');
                  setDiscrepancyOpen(true);
                }}
              >
                ثبت مغایرت
              </Button>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            تاریخچه اصلاح
          </h3>
          {correctionsQuery.isPending ? (
            <p className="text-sm text-slate-500">در حال بارگذاری…</p>
          ) : correctionsQuery.isError ? (
            <p className="text-sm text-rose-700">{mapBusinessError(correctionsQuery.error)}</p>
          ) : !correctionsQuery.data?.length ? (
            <p className="text-sm text-slate-500">اصلاحی ثبت نشده است.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-100">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">نوع</th>
                    <th className="px-3 py-2 text-start font-medium">قبل</th>
                    <th className="px-3 py-2 text-start font-medium">بعد</th>
                    <th className="px-3 py-2 text-start font-medium">دلیل</th>
                    <th className="px-3 py-2 text-start font-medium">اعمال‌کننده</th>
                  </tr>
                </thead>
                <tbody>
                  {correctionsQuery.data.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top">
                      <td className="px-3 py-2">
                        <div>{purchaseCorrectionTypeLabel(row.type)}</div>
                        <div className="font-mono text-[10px] text-slate-400" dir="ltr">
                          {row.type}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600" dir="ltr">
                        <pre className="whitespace-pre-wrap font-mono">
                          {Object.entries(row.beforeSnapshot)
                            .map(([k, v]) => `${k}: ${snapshotValue(v)}`)
                            .join('\n')}
                        </pre>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600" dir="ltr">
                        <pre className="whitespace-pre-wrap font-mono">
                          {Object.entries(row.afterSnapshot)
                            .map(([k, v]) => `${k}: ${snapshotValue(v)}`)
                            .join('\n')}
                        </pre>
                      </td>
                      <td className="px-3 py-2 text-slate-700">{row.reason}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {row.appliedBy.displayName}
                        <div>{formatDateTime(row.appliedAt)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">مغایرت‌ها</h3>
          {discrepanciesQuery.isPending ? (
            <p className="text-sm text-slate-500">در حال بارگذاری…</p>
          ) : discrepanciesQuery.isError ? (
            <p className="text-sm text-rose-700">{mapBusinessError(discrepanciesQuery.error)}</p>
          ) : !discrepanciesQuery.data?.length ? (
            <p className="text-sm text-slate-500">مغایرتی ثبت نشده است.</p>
          ) : (
            <ul className="space-y-2">
              {discrepanciesQuery.data.map((row) => {
                const item = purchaseOrder.items.find((i) => i.id === row.purchaseOrderItemId);
                return (
                  <li
                    key={row.id}
                    className="rounded-md border border-slate-100 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{purchaseDiscrepancyTypeLabel(row.type)}</Badge>
                      <span className="text-xs text-slate-500">
                        {purchaseDiscrepancySourceLabel(row.source)}
                      </span>
                      <Badge className="bg-white">{row.status}</Badge>
                    </div>
                    <div className="mt-1 text-slate-700">
                      {item ? itemLabel(item) : row.purchaseOrderItemId}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      تعداد مغایرت:{' '}
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.quantity}
                      </span>
                      {item && row.type === 'SHORT_SHIPMENT' ? (
                        <span className="ms-2 text-slate-500">
                          (سفارش:{' '}
                          <span dir="ltr">{item.quantity}</span>
                          {row.quantity <= item.quantity ? (
                            <>
                              {' '}
                              · اعلام‌شده تقریبی:{' '}
                              <span dir="ltr">{item.quantity - row.quantity}</span>
                            </>
                          ) : null}
                          )
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-slate-700">{row.reason}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {row.createdBy.displayName} · {formatDateTime(row.createdAt)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {canShortClose &&
        (purchaseOrder.status === 'ORDERED' || purchaseOrder.status === 'PARTIALLY_RECEIVED') ? (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            <h3 className="text-xs font-semibold text-slate-700">بستن مقدار تأمین‌نشده</h3>
            <p className="text-xs text-slate-500">
              مقدار سفارش اصلی تغییر نمی‌کند. این مقدار به‌عنوان بخش تأمین‌نشده بسته می‌شود.
            </p>
            <ul className="space-y-2">
              {purchaseOrder.items.map((item) => {
                const remaining = Math.max(
                  0,
                  item.quantity - (item.closedUnfulfilledQuantity ?? 0),
                );
                if (remaining <= 0) return null;
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 px-3 py-2 text-sm"
                  >
                    <div>
                      <div>{itemLabel(item)}</div>
                      <div className="text-xs text-slate-500">
                        قابل بستن:{' '}
                        <span className="font-mono" dir="ltr">
                          {remaining}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShortCloseItem(item);
                        setShortQty(String(remaining));
                        setShortReason('');
                      }}
                    >
                      بستن مقدار تأمین‌نشده
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>

      <Dialog
        open={correctOpen}
        onOpenChange={setCorrectOpen}
        title="اصلاح خرید"
        description="بعد از تأیید، اطلاعات اصلی تجاری فقط از طریق اصلاح قابل تغییر است. سرور اعتبارسنجی نهایی را انجام می‌دهد."
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="corr-type">نوع اصلاح</Label>
            <select
              id="corr-type"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={correctionType}
              onChange={(e) => setCorrectionType(e.target.value as PurchaseCorrectionType)}
            >
              {ITEM_CORRECTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {purchaseCorrectionTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="corr-item">قلم</Label>
            <select
              id="corr-item"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={correctionItemId}
              onChange={(e) => {
                const id = e.target.value;
                setCorrectionItemId(id);
                const item = purchaseOrder.items.find((i) => i.id === id);
                if (item) {
                  setCorrectionQty(String(item.quantity));
                  setCorrectionPrice(
                    purchaseOrder.currency === 'IRR'
                      ? rialsStringToTomanDisplay(item.unitPrice)
                      : item.unitPrice,
                  );
                }
              }}
            >
              {purchaseOrder.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {itemLabel(item)}
                </option>
              ))}
            </select>
          </div>
          {selectedCorrectionItem ? (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div>
                مقدار فعلی:{' '}
                <span dir="ltr">{selectedCorrectionItem.quantity}</span>
              </div>
              <div className="mt-1 flex items-center gap-1">
                قیمت فعلی:
                <OfferPriceDisplay
                  unitPrice={selectedCorrectionItem.unitPrice}
                  currency={purchaseOrder.currency}
                />
              </div>
            </div>
          ) : null}
          {correctionType === 'QUANTITY_CORRECTION' || correctionType === 'DATA_ENTRY_ERROR' ? (
            <div className="space-y-1">
              <Label htmlFor="corr-qty">تعداد جدید</Label>
              <Input
                id="corr-qty"
                dir="ltr"
                inputMode="numeric"
                value={correctionQty}
                onChange={(e) => setCorrectionQty(e.target.value)}
              />
            </div>
          ) : null}
          {correctionType === 'PRICE_CORRECTION' || correctionType === 'DATA_ENTRY_ERROR' ? (
            <div className="space-y-1">
              <Label htmlFor="corr-price">
                قیمت واحد جدید {purchaseOrder.currency === 'IRR' ? '(تومان)' : '(USD)'}
              </Label>
              <Input
                id="corr-price"
                dir="ltr"
                inputMode="decimal"
                value={correctionPrice}
                onChange={(e) => setCorrectionPrice(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="corr-reason">دلیل اصلاح</Label>
            <textarea
              id="corr-reason"
              className={textareaClassName}
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCorrectOpen(false)}>
              انصراف
            </Button>
            <Button type="button" onClick={() => setConfirmCorrect(true)}>
              پیش‌نمایش و تأیید
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmCorrect}
        onOpenChange={setConfirmCorrect}
        title="تأیید اصلاح خرید"
        description="مقادیر قبلی با مقادیر جدید جایگزین می‌شوند و در تاریخچه ثبت می‌گردند."
      >
        <div className="space-y-3">
          <div className="space-y-2 text-sm text-slate-700">
            <div>نوع: {purchaseCorrectionTypeLabel(correctionType)}</div>
            {selectedCorrectionItem ? (
              <>
                <div>قلم: {itemLabel(selectedCorrectionItem)}</div>
                {(correctionType === 'QUANTITY_CORRECTION' ||
                  correctionType === 'DATA_ENTRY_ERROR') &&
                correctionQty.trim() ? (
                  <div>
                    تعداد: <span dir="ltr">{selectedCorrectionItem.quantity}</span> →{' '}
                    <span dir="ltr">{correctionQty}</span>
                  </div>
                ) : null}
                {(correctionType === 'PRICE_CORRECTION' ||
                  correctionType === 'DATA_ENTRY_ERROR') &&
                correctionPrice.trim() ? (
                  <div className="flex flex-wrap items-center gap-1">
                    قیمت:
                    <OfferPriceDisplay
                      unitPrice={selectedCorrectionItem.unitPrice}
                      currency={purchaseOrder.currency}
                    />
                    →
                    <span dir="ltr">{correctionPrice}</span>
                    {purchaseOrder.currency === 'IRR' ? ' تومان' : ' USD'}
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="whitespace-pre-wrap">دلیل: {correctionReason}</div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmCorrect(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={correctionMutation.isPending}
              onClick={() => correctionMutation.mutate()}
            >
              {correctionMutation.isPending ? 'در حال اعمال…' : 'اعمال اصلاح'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={discrepancyOpen}
        onOpenChange={setDiscrepancyOpen}
        title="ثبت مغایرت"
        description="این ثبت، دریافت انبار نیست و موجودی را تغییر نمی‌دهد."
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="disc-item">قلم</Label>
            <select
              id="disc-item"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={discItemId}
              onChange={(e) => setDiscItemId(e.target.value)}
            >
              {purchaseOrder.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {itemLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="disc-type">نوع مغایرت</Label>
            <select
              id="disc-type"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={discType}
              onChange={(e) => setDiscType(e.target.value as PurchaseDiscrepancyType)}
            >
              {DISCREPANCY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {purchaseDiscrepancyTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="disc-qty">تعداد مغایرت</Label>
            <Input
              id="disc-qty"
              dir="ltr"
              inputMode="numeric"
              value={discQty}
              onChange={(e) => setDiscQty(e.target.value)}
            />
            <p className="text-xs text-slate-500">منبع: قبل از دریافت (BEFORE_RECEIPT)</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="disc-reason">دلیل</Label>
            <textarea
              id="disc-reason"
              className={textareaClassName}
              value={discReason}
              onChange={(e) => setDiscReason(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="disc-notes">یادداشت (اختیاری)</Label>
            <Input
              id="disc-notes"
              value={discNotes}
              onChange={(e) => setDiscNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDiscrepancyOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              onClick={() => discrepancyMutation.mutate()}
              disabled={discrepancyMutation.isPending}
            >
              ثبت مغایرت
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(shortCloseItem)}
        onOpenChange={(open) => {
          if (!open) setShortCloseItem(null);
        }}
        title="بستن مقدار تأمین‌نشده"
        description="مقدار سفارش اصلی تغییر نمی‌کند. این مقدار به‌عنوان بخش تأمین‌نشده بسته خواهد شد."
      >
        {shortCloseItem ? (
          <div className="space-y-3 text-sm">
            <div>{itemLabel(shortCloseItem)}</div>
            <div>
              سفارش داده‌شده:{' '}
              <span className="font-mono" dir="ltr">
                {shortCloseItem.quantity}
              </span>
            </div>
            <div className="space-y-1">
              <Label htmlFor="short-qty">مقدار بسته‌شونده</Label>
              <Input
                id="short-qty"
                dir="ltr"
                inputMode="numeric"
                value={shortQty}
                onChange={(e) => setShortQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="short-reason">دلیل</Label>
              <textarea
                id="short-reason"
                className={textareaClassName}
                value={shortReason}
                onChange={(e) => setShortReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShortCloseItem(null)}>
                انصراف
              </Button>
              <Button
                type="button"
                disabled={shortCloseMutation.isPending}
                onClick={() => shortCloseMutation.mutate()}
              >
                {shortCloseMutation.isPending ? 'در حال انجام…' : 'بستن کسری'}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
