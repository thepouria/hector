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
import { tomanInputToRialsString } from '@/features/purchasing/offer-money';
import { SkuLookupPicker } from '@/features/purchasing/sku-lookup-picker';
import { SupplierPicker } from '@/features/purchasing/supplier-picker';
import { createSupplierOffer, fetchSupplier } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { offerKeys } from '@/lib/query/keys';
import { ROUTES, purchasingOfferPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { OfferCurrency, PaymentTermType, PurchaseCommercialType } from '@/types/purchasing';
import type { SupplierOption } from '@/types/purchasing';
import type { SkuPickerSelection } from '@/features/purchasing/sku-lookup-picker';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

function defaultQuotedAtLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function OfferCreatePageClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const [supplier, setSupplier] = React.useState<SupplierOption | null>(null);
  const [sku, setSku] = React.useState<SkuPickerSelection | null>(null);
  const [currency, setCurrency] = React.useState<OfferCurrency>('IRR');
  const [priceInput, setPriceInput] = React.useState('');
  const [quotedAtLocal, setQuotedAtLocal] = React.useState(defaultQuotedAtLocal);
  const [purchaseType, setPurchaseType] = React.useState<PurchaseCommercialType | ''>('');
  const [paymentTermType, setPaymentTermType] = React.useState<PaymentTermType | ''>('');
  const [netDays, setNetDays] = React.useState('');
  const [validUntilLocal, setValidUntilLocal] = React.useState('');
  const [supplierContactId, setSupplierContactId] = React.useState('');
  const [quotedQuantity, setQuotedQuantity] = React.useState('');
  const [minimumQuantity, setMinimumQuantity] = React.useState('');
  const [availableQuantity, setAvailableQuantity] = React.useState('');
  const [referenceFxRate, setReferenceFxRate] = React.useState('');
  const [referenceFxBaseCurrency, setReferenceFxBaseCurrency] = React.useState<OfferCurrency | ''>(
    '',
  );
  const [referenceFxQuoteCurrency, setReferenceFxQuoteCurrency] = React.useState<
    OfferCurrency | ''
  >('');
  const [notes, setNotes] = React.useState('');

  const supplierDetailQuery = useQuery({
    queryKey: ['supplier-contacts-picker', companyId, supplier?.id],
    enabled: Boolean(companyId) && Boolean(supplier?.id),
    queryFn: () => fetchSupplier(companyId, supplier!.id),
  });

  const contacts = supplierDetailQuery.data?.contacts.filter((c) => !c.archivedAt) ?? [];

  const [stayForNext, setStayForNext] = React.useState(false);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!supplier || !sku) throw new Error('missing');
      let unitPrice: string;
      if (currency === 'IRR') {
        const rials = tomanInputToRialsString(priceInput);
        if (!rials) throw new Error('price');
        unitPrice = rials;
      } else {
        const usd = priceInput.trim();
        if (!usd) throw new Error('price');
        unitPrice = usd;
      }
      const quotedAt = new Date(quotedAtLocal).toISOString();
      return createSupplierOffer(companyId, {
        supplierId: supplier.id,
        skuId: sku.skuId,
        unitPrice,
        currency,
        quotedAt,
        ...(purchaseType ? { purchaseType } : {}),
        ...(paymentTermType ? { paymentTermType } : {}),
        ...(netDays.trim() ? { netDays: Number(netDays) } : {}),
        ...(quotedQuantity.trim() ? { quotedQuantity: Number(quotedQuantity) } : {}),
        ...(minimumQuantity.trim() ? { minimumQuantity: Number(minimumQuantity) } : {}),
        ...(availableQuantity.trim() ? { availableQuantity: Number(availableQuantity) } : {}),
        ...(referenceFxRate.trim() ? { referenceFxRate: referenceFxRate.trim() } : {}),
        ...(referenceFxBaseCurrency ? { referenceFxBaseCurrency } : {}),
        ...(referenceFxQuoteCurrency ? { referenceFxQuoteCurrency } : {}),
        ...(validUntilLocal ? { validUntil: new Date(validUntilLocal).toISOString() } : {}),
        ...(supplierContactId ? { supplierContactId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
    },
    onSuccess: async (created) => {
      toast.success('استعلام قیمت ثبت شد.');
      await queryClient.invalidateQueries({ queryKey: offerKeys.all(companyId) });
      if (stayForNext) {
        setSku(null);
        setPriceInput('');
        setQuotedQuantity('');
        setMinimumQuantity('');
        setAvailableQuantity('');
        setNotes('');
        setStayForNext(false);
        return;
      }
      router.push(purchasingOfferPath(created.id));
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'price') {
        toast.error('قیمت واحد را به‌درستی وارد کنید.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  if (!can(PERMISSIONS.PURCHASING_CREATE)) {
    return <AccessDenied />;
  }

  const priceLabel = currency === 'IRR' ? 'قیمت واحد (تومان)' : 'قیمت واحد (دلار)';

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="ثبت استعلام قیمت"
        description="ثبت سریع قیمت تأمین‌کننده برای یک SKU"
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'استعلام قیمت', href: ROUTES.purchasingOffers },
          { label: 'جدید' },
        ]}
      />

      <form
        className="space-y-5 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!supplier || !sku) {
            toast.error('تأمین‌کننده و SKU را انتخاب کنید.');
            return;
          }
          createMutation.mutate();
        }}
      >
        <SupplierPicker value={supplier} onChange={setSupplier} />
        <SkuLookupPicker value={sku} onChange={setSku} />

        {supplier && sku ? (
          <OfferLatestHint supplierId={supplier.id} skuId={sku.skuId} />
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="offer-currency">ارز</Label>
            <select
              id="offer-currency"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as OfferCurrency)}
            >
              <option value="IRR">تومان (ذخیره به ریال)</option>
              <option value="USD">دلار</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="offer-price">{priceLabel}</Label>
            <Input
              id="offer-price"
              dir="ltr"
              inputMode="decimal"
              value={priceInput}
              onChange={(event) => setPriceInput(event.target.value)}
              placeholder={currency === 'IRR' ? 'مثلاً 585000' : 'مثلاً 12.50'}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="offer-quoted-at">تاریخ استعلام</Label>
            <Input
              id="offer-quoted-at"
              type="datetime-local"
              dir="ltr"
              value={quotedAtLocal}
              onChange={(event) => setQuotedAtLocal(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="offer-purchase-type">نوع خرید</Label>
            <select
              id="offer-purchase-type"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={purchaseType}
              onChange={(event) =>
                setPurchaseType(event.target.value as PurchaseCommercialType | '')
              }
            >
              <option value="">—</option>
              <option value="CASH">نقدی</option>
              <option value="TERM_CREDIT">اعتباری ریالی</option>
              <option value="FX_CREDIT">اعتباری ارزی</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="offer-payment-term">شرایط پرداخت</Label>
            <select
              id="offer-payment-term"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={paymentTermType}
              onChange={(event) =>
                setPaymentTermType(event.target.value as PaymentTermType | '')
              }
            >
              <option value="">—</option>
              <option value="IMMEDIATE">فوری</option>
              <option value="NET_DAYS">NET</option>
              <option value="FIXED_DATE">تاریخ ثابت</option>
            </select>
          </div>
          {paymentTermType === 'NET_DAYS' ? (
            <div className="space-y-1">
              <Label htmlFor="offer-net-days">NET (روز)</Label>
              <Input
                id="offer-net-days"
                dir="ltr"
                inputMode="numeric"
                value={netDays}
                onChange={(event) => setNetDays(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        <details className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">
            فیلدهای تکمیلی (اختیاری)
          </summary>
          <div className="mt-4 space-y-4">
            <div className="space-y-1">
              <Label htmlFor="offer-valid-until">اعتبار تا</Label>
              <Input
                id="offer-valid-until"
                type="datetime-local"
                dir="ltr"
                value={validUntilLocal}
                onChange={(event) => setValidUntilLocal(event.target.value)}
              />
            </div>
            {supplier ? (
              <div className="space-y-1">
                <Label htmlFor="offer-contact">مخاطب تأمین‌کننده</Label>
                <select
                  id="offer-contact"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={supplierContactId}
                  onChange={(event) => setSupplierContactId(event.target.value)}
                >
                  <option value="">—</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                      {contact.role ? ` (${contact.role})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="offer-quoted-qty">مقدار استعلام</Label>
                <Input
                  id="offer-quoted-qty"
                  dir="ltr"
                  inputMode="numeric"
                  value={quotedQuantity}
                  onChange={(event) => setQuotedQuantity(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="offer-min-qty">حداقل سفارش</Label>
                <Input
                  id="offer-min-qty"
                  dir="ltr"
                  inputMode="numeric"
                  value={minimumQuantity}
                  onChange={(event) => setMinimumQuantity(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="offer-avail-qty">موجودی اعلامی</Label>
                <Input
                  id="offer-avail-qty"
                  dir="ltr"
                  inputMode="numeric"
                  value={availableQuantity}
                  onChange={(event) => setAvailableQuantity(event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="offer-fx-rate">نرخ ارز مرجع</Label>
                <Input
                  id="offer-fx-rate"
                  dir="ltr"
                  value={referenceFxRate}
                  onChange={(event) => setReferenceFxRate(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="offer-fx-base">ارز پایه</Label>
                <select
                  id="offer-fx-base"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={referenceFxBaseCurrency}
                  onChange={(event) =>
                    setReferenceFxBaseCurrency(event.target.value as OfferCurrency | '')
                  }
                >
                  <option value="">—</option>
                  <option value="IRR">IRR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="offer-fx-quote">ارز مقابل</Label>
                <select
                  id="offer-fx-quote"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={referenceFxQuoteCurrency}
                  onChange={(event) =>
                    setReferenceFxQuoteCurrency(event.target.value as OfferCurrency | '')
                  }
                >
                  <option value="">—</option>
                  <option value="IRR">IRR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="offer-notes">یادداشت</Label>
              <textarea
                id="offer-notes"
                className={textareaClassName}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
        </details>

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={createMutation.isPending}
            onClick={() => setStayForNext(false)}
          >
            {createMutation.isPending ? 'در حال ثبت...' : 'ذخیره'}
          </Button>
          <Button
            type="submit"
            variant="outline"
            disabled={createMutation.isPending}
            onClick={() => setStayForNext(true)}
          >
            ثبت و افزودن قیمت بعدی
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(ROUTES.purchasingOffers)}>
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
