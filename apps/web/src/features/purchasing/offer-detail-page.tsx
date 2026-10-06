'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EntityHistory } from '@/features/catalog/entity-history';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import {
  expiryStateLabel,
  formatQuoteAge,
  paymentTermLabel,
  purchaseTypeLabel,
} from '@/features/purchasing/offer-labels';
import {
  rialsStringToTomanDisplay,
  tomanInputToRialsString,
} from '@/features/purchasing/offer-money';
import {
  archiveSupplierOffer,
  fetchSupplierOffer,
  updateSupplierOffer,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { offerKeys } from '@/lib/query/keys';
import {
  ROUTES,
  catalogSkuPath,
  purchasingOfferComparePath,
  purchasingSupplierPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { OfferCurrency, PaymentTermType, PurchaseCommercialType } from '@/types/purchasing';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{children}</div>
    </div>
  );
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function OfferDetailPageClient({ offerId }: { offerId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.PURCHASING_MANAGE);

  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  const detailQuery = useQuery({
    queryKey: offerKeys.detail(companyId, offerId),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchSupplierOffer(companyId, offerId),
  });

  const offer = detailQuery.data;

  const [currency, setCurrency] = React.useState<OfferCurrency>('IRR');
  const [priceInput, setPriceInput] = React.useState('');
  const [quotedAtLocal, setQuotedAtLocal] = React.useState('');
  const [purchaseType, setPurchaseType] = React.useState<PurchaseCommercialType | ''>('');
  const [paymentTermType, setPaymentTermType] = React.useState<PaymentTermType | ''>('');
  const [netDays, setNetDays] = React.useState('');
  const [validUntilLocal, setValidUntilLocal] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const openEdit = () => {
    if (!offer) return;
    setCurrency(offer.currency);
    setPriceInput(
      offer.currency === 'IRR'
        ? rialsStringToTomanDisplay(offer.unitPrice)
        : offer.unitPrice,
    );
    setQuotedAtLocal(toDatetimeLocal(offer.quotedAt));
    setPurchaseType(offer.purchaseType ?? '');
    setPaymentTermType(offer.paymentTermType ?? '');
    setNetDays(offer.netDays != null ? String(offer.netDays) : '');
    setValidUntilLocal(toDatetimeLocal(offer.validUntil));
    setNotes(offer.notes ?? '');
    setEditOpen(true);
  };

  React.useEffect(() => {
    if (
      detailQuery.error &&
      isApiClientError(detailQuery.error) &&
      detailQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [detailQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: offerKeys.all(companyId) });
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      let unitPrice: string | undefined;
      if (currency === 'IRR') {
        const rials = tomanInputToRialsString(priceInput);
        if (!rials) throw new Error('price');
        unitPrice = rials;
      } else if (priceInput.trim()) {
        unitPrice = priceInput.trim();
      }
      return updateSupplierOffer(companyId, offerId, {
        ...(unitPrice ? { unitPrice, currency } : { currency }),
        quotedAt: new Date(quotedAtLocal).toISOString(),
        purchaseType: purchaseType || null,
        paymentTermType: paymentTermType || null,
        netDays: netDays.trim() ? Number(netDays) : null,
        validUntil: validUntilLocal ? new Date(validUntilLocal).toISOString() : null,
        notes: notes.trim() ? notes.trim() : null,
      });
    },
    onSuccess: async () => {
      toast.success('استعلام به‌روزرسانی شد.');
      setEditOpen(false);
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'price') {
        toast.error('قیمت واحد نامعتبر است.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveSupplierOffer(companyId, offerId),
    onSuccess: async () => {
      toast.success('استعلام بایگانی شد.');
      setArchiveOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.PURCHASING_READ)) {
    return <AccessDenied />;
  }

  if (detailQuery.isLoading) {
    return <PageSkeleton />;
  }

  if (detailQuery.isError || !offer) {
    return (
      <ErrorState
        title="استعلام پیدا نشد"
        message={mapBusinessError(detailQuery.error)}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const quoteAge = formatQuoteAge(offer.quotedAt);
  const archived = Boolean(offer.archivedAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title="جزئیات استعلام قیمت"
        description={`${offer.supplier.name} · ${offer.sku.code}`}
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'استعلام قیمت', href: ROUTES.purchasingOffers },
          { label: offer.sku.code },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(purchasingOfferComparePath(offer.skuId))}
            >
              مقایسه این SKU
            </Button>
            {canManage && !archived ? (
              <>
                <Button type="button" variant="outline" onClick={openEdit}>
                  اصلاح
                </Button>
                <Button type="button" variant="danger" onClick={() => setArchiveOpen(true)}>
                  بایگانی
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="قیمت واحد">
          <OfferPriceDisplay unitPrice={offer.unitPrice} currency={offer.currency} />
        </Field>
        <Field label="وضعیت">
          <Badge>{expiryStateLabel(offer.expiryState)}</Badge>
        </Field>
        <Field label="زمان استعلام">
          {quoteAge.relative}
          <div className="text-xs text-slate-500">{quoteAge.exact}</div>
        </Field>
        <Field label="تأمین‌کننده">
          <Link href={purchasingSupplierPath(offer.supplierId)} className="text-slate-900 underline">
            {offer.supplier.name}
          </Link>
        </Field>
        <Field label="SKU">
          <Link href={catalogSkuPath(offer.skuId)} className="font-mono underline" dir="ltr">
            {offer.sku.code}
          </Link>
          <div className="text-xs text-slate-500">{offer.sku.product.name}</div>
        </Field>
        <Field label="نوع خرید / پرداخت">
          {purchaseTypeLabel(offer.purchaseType)}
          {offer.paymentTermType ? (
            <span className="text-slate-600">
              {' '}
              · {paymentTermLabel(offer.paymentTermType)}
              {offer.netDays ? ` (${offer.netDays} روز)` : ''}
            </span>
          ) : null}
        </Field>
        <Field label="اعتبار تا">
          {offer.validUntil ? formatDateTime(offer.validUntil) : 'بدون انقضا'}
        </Field>
        <Field label="ثبت توسط">{offer.createdBy.displayName}</Field>
        <Field label="تاریخ ثبت">{formatDateTime(offer.createdAt)}</Field>
        {offer.supplierContact ? (
          <Field label="مخاطب">{offer.supplierContact.name}</Field>
        ) : null}
        {offer.notes ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="یادداشت">{offer.notes}</Field>
          </div>
        ) : null}
      </div>

      <EntityHistory entityType="SUPPLIER_OFFER" entityId={offerId} />

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="اصلاح استعلام">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            updateMutation.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-currency">ارز</Label>
              <select
                id="edit-currency"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as OfferCurrency)}
              >
                <option value="IRR">تومان (ذخیره به ریال)</option>
                <option value="USD">دلار</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-price">
                {currency === 'IRR' ? 'قیمت (تومان)' : 'قیمت (دلار)'}
              </Label>
              <Input
                id="edit-price"
                dir="ltr"
                value={priceInput}
                onChange={(event) => setPriceInput(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-quoted">تاریخ استعلام</Label>
            <Input
              id="edit-quoted"
              type="datetime-local"
              dir="ltr"
              value={quotedAtLocal}
              onChange={(event) => setQuotedAtLocal(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-purchase">نوع خرید</Label>
              <select
                id="edit-purchase"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={purchaseType}
                onChange={(event) =>
                  setPurchaseType(event.target.value as PurchaseCommercialType | '')
                }
              >
                <option value="">—</option>
                <option value="CASH">نقد</option>
                <option value="TERM_CREDIT">اعتبار مدت‌دار</option>
                <option value="FX_CREDIT">اعتبار ارزی</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-payment">شرایط پرداخت</Label>
              <select
                id="edit-payment"
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
          </div>
          {paymentTermType === 'NET_DAYS' ? (
            <div className="space-y-1">
              <Label htmlFor="edit-net">NET (روز)</Label>
              <Input
                id="edit-net"
                dir="ltr"
                value={netDays}
                onChange={(event) => setNetDays(event.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="edit-valid">اعتبار تا</Label>
            <Input
              id="edit-valid"
              type="datetime-local"
              dir="ltr"
              value={validUntilLocal}
              onChange={(event) => setValidUntilLocal(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-notes">یادداشت</Label>
            <textarea
              id="edit-notes"
              className={textareaClassName}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={updateMutation.isPending}>
              ذخیره
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              انصراف
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="بایگانی استعلام"
        description="این استعلام بایگانی می‌شود و در فهرست‌های پیش‌فرض نمایش داده نمی‌شود."
        confirmLabel="بایگانی"
        danger
        loading={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
      />
    </div>
  );
}
