'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OfferLatestHint } from '@/features/purchasing/offer-latest-hint';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import {
  rialsStringToTomanDisplay,
  tomanInputToRialsString,
} from '@/features/purchasing/offer-money';
import {
  previewDueDateFromOrderDate,
  previewLineSubtotal,
} from '@/features/purchasing/purchase-order-labels';
import { purchaseTypeFormVisibility } from '@/features/purchasing/purchase-form-visibility';
import { SkuLookupPicker, type SkuPickerSelection } from '@/features/purchasing/sku-lookup-picker';
import { SupplierPicker } from '@/features/purchasing/supplier-picker';
import {
  createPurchaseOrder,
  fetchLatestSupplierOffer,
  fetchSupplier,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { offerKeys, purchaseOrderKeys } from '@/lib/query/keys';
import { ROUTES, purchasingOrderPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type {
  OfferCurrency,
  PaymentTermType,
  PurchaseCommercialType,
  SupplierOption,
} from '@/types/purchasing';

const NET_DAY_PRESETS = [7, 10, 15, 30, 45, 60] as const;

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

type DraftLine = {
  key: string;
  sku: SkuPickerSelection | null;
  quantity: string;
  priceInput: string;
  supplierOfferId: string | null;
  quotedUnitPrice: string | null;
  notes: string;
};

function defaultOrderDateLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function newLine(): DraftLine {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: null,
    quantity: '1',
    priceInput: '',
    supplierOfferId: null,
    quotedUnitPrice: null,
    notes: '',
  };
}

function resolveUnitPrice(currency: OfferCurrency, priceInput: string): string | null {
  if (currency === 'IRR') return tomanInputToRialsString(priceInput);
  const usd = priceInput.trim();
  if (!usd || !/^\d+(\.\d{1,6})?$/.test(usd) || Number(usd) <= 0) return null;
  return usd;
}

function hasTermsEntered(
  purchaseType: PurchaseCommercialType,
  netDays: string,
  referenceFxToman: string,
): boolean {
  if (purchaseType === 'CASH') return false;
  if (netDays.trim()) return true;
  if (purchaseType === 'FX_CREDIT' && referenceFxToman.trim()) return true;
  return false;
}

export function PurchaseOrderCreatePageClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const [supplier, setSupplier] = React.useState<SupplierOption | null>(null);
  const [currency, setCurrency] = React.useState<OfferCurrency>('IRR');
  const [purchaseType, setPurchaseType] = React.useState<PurchaseCommercialType>('CASH');
  const [paymentTermType, setPaymentTermType] =
    React.useState<PaymentTermType>('IMMEDIATE');
  const [netDays, setNetDays] = React.useState('');
  const [fixedDueDate, setFixedDueDate] = React.useState('');
  const [paymentTermsNote, setPaymentTermsNote] = React.useState('');
  const [referenceFxToman, setReferenceFxToman] = React.useState('');
  const [orderDate, setOrderDate] = React.useState(defaultOrderDateLocal);
  const [expectedAt, setExpectedAt] = React.useState('');
  const [supplierContactId, setSupplierContactId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>([newLine()]);
  const [activeOfferLineKey, setActiveOfferLineKey] = React.useState<string | null>(null);

  const supplierDetailQuery = useQuery({
    queryKey: ['supplier-contacts-picker', companyId, supplier?.id],
    enabled: Boolean(companyId) && Boolean(supplier?.id),
    queryFn: () => fetchSupplier(companyId, supplier!.id),
  });
  const contacts = supplierDetailQuery.data?.contacts.filter((c) => !c.archivedAt) ?? [];

  const changePurchaseType = (next: PurchaseCommercialType) => {
    if (next === purchaseType) return;
    if (
      hasTermsEntered(purchaseType, netDays, referenceFxToman) &&
      !window.confirm(
        'تغییر نوع خرید، شرایط تجاری ناسازگار (مهلت، تعهد ارزی، نرخ مرجع) را پاک می‌کند. ادامه؟',
      )
    ) {
      return;
    }
    setPurchaseType(next);
    setNetDays('');
    setFixedDueDate('');
    setReferenceFxToman('');
    setPaymentTermType(next === 'CASH' ? 'IMMEDIATE' : 'NET_DAYS');
    if (next === 'FX_CREDIT' && currency !== 'USD') {
      setCurrency('USD');
      setLines((prev) =>
        prev.map((line) => ({
          ...line,
          priceInput: '',
          supplierOfferId: null,
          quotedUnitPrice: null,
        })),
      );
    }
    if ((next === 'CASH' || next === 'TERM_CREDIT') && currency !== 'IRR') {
      setCurrency('IRR');
      setLines((prev) =>
        prev.map((line) => ({
          ...line,
          priceInput: '',
          supplierOfferId: null,
          quotedUnitPrice: null,
        })),
      );
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!supplier) throw new Error('supplier');
      const items = lines.map((line) => {
        if (!line.sku) throw new Error('sku');
        const quantity = Number(line.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
        const unitPrice = resolveUnitPrice(currency, line.priceInput);
        if (!unitPrice) throw new Error('price');
        return {
          skuId: line.sku.skuId,
          quantity,
          unitPrice,
          ...(line.supplierOfferId ? { supplierOfferId: line.supplierOfferId } : {}),
          ...(line.notes.trim() ? { notes: line.notes.trim() } : {}),
        };
      });
      if (items.length === 0) throw new Error('empty');
      const skuIds = items.map((item) => item.skuId);
      if (new Set(skuIds).size !== skuIds.length) throw new Error('duplicate');

      const credit = purchaseType === 'TERM_CREDIT' || purchaseType === 'FX_CREDIT';
      const termType: PaymentTermType = credit ? paymentTermType : 'IMMEDIATE';
      const parsedNetDays = netDays.trim() ? Number(netDays.trim()) : null;
      if (
        credit &&
        termType === 'NET_DAYS' &&
        parsedNetDays !== null &&
        (!Number.isInteger(parsedNetDays) || parsedNetDays < 1)
      ) {
        throw new Error('netDays');
      }
      if (credit && termType === 'FIXED_DATE' && !fixedDueDate.trim()) {
        // Draft may omit; only validate format when provided.
      }
      if (credit && termType === 'FIXED_DATE' && fixedDueDate.trim()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fixedDueDate.trim())) throw new Error('fixedDue');
      }

      let referenceFxRate: string | undefined;
      if (purchaseType === 'FX_CREDIT' && referenceFxToman.trim()) {
        const irr = tomanInputToRialsString(referenceFxToman);
        if (!irr) throw new Error('fxRate');
        referenceFxRate = irr;
      }

      return createPurchaseOrder(companyId, {
        supplierId: supplier.id,
        currency,
        purchaseType,
        paymentTermType: termType,
        ...(termType === 'NET_DAYS' && parsedNetDays != null ? { netDays: parsedNetDays } : {}),
        ...(termType === 'FIXED_DATE' && fixedDueDate.trim()
          ? { dueDate: `${fixedDueDate.trim()}T12:00:00.000Z` }
          : {}),
        ...(paymentTermsNote.trim() ? { paymentTermsNote: paymentTermsNote.trim() } : {}),
        ...(purchaseType === 'FX_CREDIT' && referenceFxRate
          ? {
              referenceFxRate,
              referenceFxBaseCurrency: currency,
              referenceFxQuoteCurrency: 'IRR' as const,
            }
          : {}),
        orderDate: new Date(`${orderDate}T12:00:00`).toISOString(),
        ...(expectedAt ? { expectedAt: new Date(expectedAt).toISOString() } : {}),
        ...(supplierContactId ? { supplierContactId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        items,
      });
    },
    onSuccess: async (created) => {
      toast.success('پیش‌نویس سفارش ثبت شد.');
      await queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all(companyId) });
      router.push(purchasingOrderPath(created.id));
    },
    onError: (error) => {
      if (error instanceof Error) {
        if (error.message === 'supplier') {
          toast.error('تأمین‌کننده را انتخاب کنید.');
          return;
        }
        if (error.message === 'sku') {
          toast.error('برای هر ردیف یک SKU انتخاب کنید.');
          return;
        }
        if (error.message === 'quantity') {
          toast.error('تعداد باید عدد صحیح مثبت باشد.');
          return;
        }
        if (error.message === 'price') {
          toast.error('قیمت واحد را به‌درستی وارد کنید.');
          return;
        }
        if (error.message === 'duplicate') {
          toast.error('هر SKU فقط یک‌بار در سفارش مجاز است.');
          return;
        }
        if (error.message === 'netDays') {
          toast.error('مهلت پرداخت باید عدد صحیح مثبت باشد.');
          return;
        }
        if (error.message === 'fixedDue') {
          toast.error('تاریخ سررسید را به‌درستی وارد کنید.');
          return;
        }
        if (error.message === 'fxRate') {
          toast.error('نرخ مرجع ارز را به‌درستی وارد کنید.');
          return;
        }
      }
      toast.error(mapBusinessError(error));
    },
  });

  const applyLatestOffer = async (lineKey: string, skuId: string) => {
    if (!supplier) {
      toast.error('ابتدا تأمین‌کننده را انتخاب کنید.');
      return;
    }
    setActiveOfferLineKey(lineKey);
    try {
      const latest = await queryClient.fetchQuery({
        queryKey: offerKeys.latest(companyId, supplier.id, skuId),
        queryFn: () => fetchLatestSupplierOffer(companyId, supplier.id, skuId),
      });
      if (!latest) {
        toast.message('استعلام قیمتی برای این تأمین‌کننده و SKU پیدا نشد.');
        return;
      }
      if (latest.currency !== currency) {
        toast.error('ارز استعلام با ارز سفارش یکسان نیست.');
        return;
      }
      setLines((prev) =>
        prev.map((line) => {
          if (line.key !== lineKey) return line;
          return {
            ...line,
            supplierOfferId: latest.id,
            quotedUnitPrice: latest.unitPrice,
            priceInput:
              currency === 'IRR'
                ? rialsStringToTomanDisplay(latest.unitPrice)
                : latest.unitPrice,
          };
        }),
      );
      // Copy commercial suggestions from the offer snapshot; PO remains editable authority.
      if (latest.purchaseType) {
        setPurchaseType(latest.purchaseType);
        if (latest.purchaseType === 'TERM_CREDIT' || latest.purchaseType === 'FX_CREDIT') {
          setNetDays(latest.netDays != null ? String(latest.netDays) : '');
        } else {
          setNetDays('');
        }
        if (
          latest.purchaseType === 'FX_CREDIT' &&
          latest.referenceFxRate &&
          latest.referenceFxQuoteCurrency === 'IRR'
        ) {
          setReferenceFxToman(rialsStringToTomanDisplay(latest.referenceFxRate));
        } else {
          setReferenceFxToman('');
        }
      }
      toast.success('قیمت و پیشنهاد شرایط تجاری از استعلام کپی شد (قابل مذاکره).');
    } catch (error) {
      toast.error(mapBusinessError(error));
    } finally {
      setActiveOfferLineKey(null);
    }
  };

  if (!can(PERMISSIONS.PURCHASING_CREATE)) {
    return <AccessDenied />;
  }

  const priceLabel = currency === 'IRR' ? 'قیمت واحد (تومان)' : 'قیمت واحد (دلار)';
  const { showCreditTerms, showFx } = purchaseTypeFormVisibility(purchaseType);
  const previewDue =
    showCreditTerms && paymentTermType === 'NET_DAYS' && netDays.trim()
      ? previewDueDateFromOrderDate(orderDate, Number(netDays.trim()))
      : paymentTermType === 'FIXED_DATE' && fixedDueDate
        ? fixedDueDate
        : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="سفارش خرید جدید"
        description="ایجاد پیش‌نویس تعهد خرید با حداقل یک قلم"
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'سفارش‌های خرید', href: ROUTES.purchasingOrders },
          { label: 'جدید' },
        ]}
      />

      <form
        className="space-y-5 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate();
        }}
      >
        <SupplierPicker
          value={supplier}
          onChange={(next) => {
            setSupplier(next);
            setSupplierContactId('');
            setLines((prev) =>
              prev.map((line) => ({
                ...line,
                supplierOfferId: null,
                quotedUnitPrice: null,
              })),
            );
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="po-purchase-type">نوع خرید</Label>
            <select
              id="po-purchase-type"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={purchaseType}
              onChange={(event) =>
                changePurchaseType(event.target.value as PurchaseCommercialType)
              }
            >
              <option value="CASH">نقدی</option>
              <option value="TERM_CREDIT">اعتباری ریالی</option>
              <option value="FX_CREDIT">اعتباری ارزی</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="po-currency">ارز</Label>
            <select
              id="po-currency"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value as OfferCurrency);
                setLines((prev) =>
                  prev.map((line) => ({
                    ...line,
                    priceInput: '',
                    supplierOfferId: null,
                    quotedUnitPrice: null,
                  })),
                );
              }}
            >
              <option value="IRR">تومان (ذخیره به ریال)</option>
              <option value="USD">دلار</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="po-order-date">تاریخ سفارش</Label>
            <Input
              id="po-order-date"
              type="date"
              dir="ltr"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="po-expected">تاریخ انتظار دریافت (اختیاری)</Label>
            <Input
              id="po-expected"
              type="datetime-local"
              dir="ltr"
              value={expectedAt}
              onChange={(event) => setExpectedAt(event.target.value)}
            />
          </div>
        </div>

        {showCreditTerms || showFx ? (
          <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50/70 p-3">
            <h3 className="text-sm font-semibold text-slate-900">شرایط پرداخت</h3>
            {showCreditTerms ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="po-payment-term">نوع شرایط</Label>
                  <select
                    id="po-payment-term"
                    className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                    value={paymentTermType}
                    onChange={(event) => {
                      const next = event.target.value as PaymentTermType;
                      setPaymentTermType(next);
                      if (next === 'NET_DAYS') setFixedDueDate('');
                      if (next === 'FIXED_DATE') setNetDays('');
                      if (next === 'IMMEDIATE') {
                        setNetDays('');
                        setFixedDueDate('');
                      }
                    }}
                  >
                    <option value="NET_DAYS">مدت‌دار</option>
                    <option value="FIXED_DATE">تاریخ سررسید مشخص</option>
                    {purchaseType === 'FX_CREDIT' ? (
                      <option value="IMMEDIATE">فوری</option>
                    ) : null}
                  </select>
                </div>
                {paymentTermType === 'NET_DAYS' ? (
                  <div className="space-y-1">
                    <Label htmlFor="po-net-days">مدت پرداخت (روز)</Label>
                    <Input
                      id="po-net-days"
                      dir="ltr"
                      inputMode="numeric"
                      value={netDays}
                      onChange={(event) => setNetDays(event.target.value)}
                      placeholder="مثلاً ۳۰"
                    />
                    <div className="flex flex-wrap gap-1 pt-1">
                      {NET_DAY_PRESETS.map((days) => (
                        <button
                          key={days}
                          type="button"
                          className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => setNetDays(String(days))}
                        >
                          {days} روز
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">
                      مبنای محاسبه: تاریخ سفارش · تقویم روزشمار (نه روز کاری)
                    </p>
                  </div>
                ) : null}
                {paymentTermType === 'FIXED_DATE' ? (
                  <div className="space-y-1">
                    <Label htmlFor="po-fixed-due">تاریخ سررسید</Label>
                    <Input
                      id="po-fixed-due"
                      type="date"
                      dir="ltr"
                      value={fixedDueDate}
                      onChange={(event) => setFixedDueDate(event.target.value)}
                    />
                  </div>
                ) : null}
                {previewDue ? (
                  <div className="space-y-1 sm:col-span-2">
                    <div className="text-xs font-medium text-slate-500">پیش‌نمایش سررسید</div>
                    <div className="text-sm tabular-nums text-slate-900" dir="ltr">
                      {previewDue}
                    </div>
                    <p className="text-xs text-slate-500">سرور تاریخ نهایی را محاسبه/اعتبارسنجی می‌کند.</p>
                  </div>
                ) : null}
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="po-terms-note">یادداشت شرایط پرداخت (اختیاری)</Label>
                  <Input
                    id="po-terms-note"
                    value={paymentTermsNote}
                    onChange={(event) => setPaymentTermsNote(event.target.value)}
                    placeholder="مثلاً تسویه حداکثر تا پایان روز سررسید"
                  />
                </div>
              </div>
            ) : null}
            {showFx ? (
              <div className="space-y-1">
                <Label htmlFor="po-fx-rate">نرخ مرجع هنگام خرید (تومان / {currency})</Label>
                <Input
                  id="po-fx-rate"
                  dir="ltr"
                  inputMode="numeric"
                  value={referenceFxToman}
                  onChange={(event) => setReferenceFxToman(event.target.value)}
                  placeholder="مثلاً 205000"
                />
                <p className="text-xs text-slate-500">
                  مبلغ تعهد بر اساس ارز ثبت می‌شود. نرخ مرجع صرفاً نرخ زمان خرید است و مبلغ نهایی
                  تسویه را تعیین نمی‌کند.
                </p>
                {referenceFxToman.trim() ? (
                  <div className="rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs text-amber-950">
                    <div>
                      تعهد اقلام پس از ذخیره به‌صورت مبلغ ارزی سفارش ثبت می‌شود (نه جمع تومان).
                    </div>
                    <div className="mt-1" dir="ltr">
                      نرخ مرجع ورودی: {referenceFxToman} تومان / {currency}
                    </div>
                    <div className="mt-1 text-amber-800">
                      ارزش ریالی مرجع صرفاً برای نمایش/مقایسه است و تسویه نهایی نیست.
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {contacts.length > 0 ? (
          <div className="space-y-1">
            <Label htmlFor="po-contact">مخاطب تأمین‌کننده (اختیاری)</Label>
            <select
              id="po-contact"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={supplierContactId}
              onChange={(event) => setSupplierContactId(event.target.value)}
            >
              <option value="">—</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                  {contact.role ? ` — ${contact.role}` : ''}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">اقلام</h2>
            <Button type="button" variant="outline" onClick={() => setLines((prev) => [...prev, newLine()])}>
              افزودن ردیف
            </Button>
          </div>

          {lines.map((line, index) => {
            const unitPrice = resolveUnitPrice(currency, line.priceInput);
            const qty = Number(line.quantity);
            const preview =
              unitPrice && Number.isInteger(qty) ? previewLineSubtotal(qty, unitPrice) : null;
            const priceDiffers =
              line.quotedUnitPrice &&
              unitPrice &&
              line.quotedUnitPrice !== unitPrice;

            return (
              <div
                key={line.key}
                className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500">ردیف {index + 1}</span>
                  {lines.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setLines((prev) => prev.filter((row) => row.key !== line.key))}
                    >
                      حذف
                    </Button>
                  ) : null}
                </div>

                <SkuLookupPicker
                  id={`po-sku-${line.key}`}
                  value={line.sku}
                  onChange={(sku) =>
                    setLines((prev) =>
                      prev.map((row) =>
                        row.key === line.key
                          ? {
                              ...row,
                              sku,
                              supplierOfferId: null,
                              quotedUnitPrice: null,
                            }
                          : row,
                      ),
                    )
                  }
                />

                {supplier && line.sku ? (
                  <div className="space-y-2">
                    <OfferLatestHint supplierId={supplier.id} skuId={line.sku.skuId} />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={activeOfferLineKey === line.key}
                      onClick={() => applyLatestOffer(line.key, line.sku!.skuId)}
                    >
                      استفاده از آخرین استعلام
                    </Button>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor={`po-qty-${line.key}`}>تعداد</Label>
                    <Input
                      id={`po-qty-${line.key}`}
                      dir="ltr"
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((prev) =>
                          prev.map((row) =>
                            row.key === line.key ? { ...row, quantity: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`po-price-${line.key}`}>{priceLabel}</Label>
                    <Input
                      id={`po-price-${line.key}`}
                      dir="ltr"
                      inputMode="decimal"
                      value={line.priceInput}
                      onChange={(event) =>
                        setLines((prev) =>
                          prev.map((row) =>
                            row.key === line.key ? { ...row, priceInput: event.target.value } : row,
                          ),
                        )
                      }
                      placeholder={currency === 'IRR' ? 'مثلاً 585000' : 'مثلاً 1.25'}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>جمع ردیف (پیش‌نمایش)</Label>
                    <div className="flex h-10 items-center text-sm text-slate-800">
                      {preview ? (
                        <OfferPriceDisplay unitPrice={preview} currency={currency} />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </div>
                  </div>
                </div>

                {priceDiffers && line.quotedUnitPrice ? (
                  <p className="text-xs text-amber-800">
                    استعلام:{' '}
                    <OfferPriceDisplay unitPrice={line.quotedUnitPrice} currency={currency} />
                    {' · '}
                    سفارش:{' '}
                    {unitPrice ? (
                      <OfferPriceDisplay unitPrice={unitPrice} currency={currency} />
                    ) : (
                      '—'
                    )}
                    {' — '}
                    تفاوت قیمت مذاکره‌ای مجاز است.
                  </p>
                ) : null}

                <div className="space-y-1">
                  <Label htmlFor={`po-line-notes-${line.key}`}>یادداشت ردیف (اختیاری)</Label>
                  <Input
                    id={`po-line-notes-${line.key}`}
                    value={line.notes}
                    onChange={(event) =>
                      setLines((prev) =>
                        prev.map((row) =>
                          row.key === line.key ? { ...row, notes: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-1">
          <Label htmlFor="po-notes">یادداشت سفارش (اختیاری)</Label>
          <textarea
            id="po-notes"
            className={textareaClassName}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(ROUTES.purchasingOrders)}
          >
            انصراف
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'در حال ذخیره…' : 'ذخیره پیش‌نویس'}
          </Button>
        </div>
      </form>
    </div>
  );
}
