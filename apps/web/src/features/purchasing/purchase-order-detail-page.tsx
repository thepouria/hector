'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PurchaseOrderActivity } from '@/features/purchasing/purchase-order-activity';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import {
  formatGroupedDigits,
  rialsStringToTomanDisplay,
  tomanInputToRialsString,
} from '@/features/purchasing/offer-money';
import {
  paymentTermsSummary,
  previewDueDateFromOrderDate,
  purchaseCostStatusLabel,
  purchaseCostTypeLabel,
  purchaseDueStatusBadgeClass,
  purchaseDueStatusLabel,
  purchaseOrderStatusBadgeClass,
  purchaseOrderStatusLabel,
  purchaseTypeLabel,
} from '@/features/purchasing/purchase-order-labels';
import { PurchaseOrderPostCommitPanel } from '@/features/purchasing/purchase-order-post-commit-panel';
import { PurchaseOrderReceivingPanel } from '@/features/purchasing/purchase-order-receiving-panel';
import { SkuLookupPicker, type SkuPickerSelection } from '@/features/purchasing/sku-lookup-picker';
import {
  addPurchaseOrderItem,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrderCost,
  fetchPurchaseOrder,
  markPurchaseOrderOrdered,
  removePurchaseOrderCost,
  removePurchaseOrderItem,
  updatePurchaseOrder,
  updatePurchaseOrderItem,
  voidPurchaseOrderCost,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { purchaseOrderKeys, purchasingKeys } from '@/lib/query/keys';
import {
  ROUTES,
  catalogSkuPath,
  purchasingOfferPath,
  purchasingReturnNewPath,
  purchasingSupplierPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type {
  OfferCurrency,
  PaymentTermType,
  PurchaseCommercialType,
  PurchaseCostType,
  PurchaseOrderCost,
  PurchaseOrderItem,
} from '@/types/purchasing';

const COST_TYPES: PurchaseCostType[] = [
  'COURIER',
  'FREIGHT',
  'PURCHASE_FEE',
  'TRANSFER_FEE',
  'PACKAGING',
  'CUSTOMS',
  'OTHER',
];

const NET_DAY_PRESETS = [7, 10, 15, 30, 45, 60] as const;

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

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function resolveUnitPrice(currency: OfferCurrency, priceInput: string): string | null {
  if (currency === 'IRR') return tomanInputToRialsString(priceInput);
  const usd = priceInput.trim();
  if (!usd || !/^\d+(\.\d{1,6})?$/.test(usd) || Number(usd) <= 0) return null;
  return usd;
}

function itemDisplayName(item: PurchaseOrderItem): string {
  return (
    item.productNameSnapshot ??
    item.sku.product.name ??
    item.sku.name ??
    item.skuCodeSnapshot ??
    item.sku.code
  );
}

function itemSkuCode(item: PurchaseOrderItem): string {
  return item.skuCodeSnapshot ?? item.sku.code;
}

export function PurchaseOrderDetailPageClient({
  purchaseOrderId,
}: {
  purchaseOrderId: string;
}) {
  const queryClient = useQueryClient();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';

  const canManage = can(PERMISSIONS.PURCHASING_MANAGE);
  const canApprove = can(PERMISSIONS.PURCHASING_APPROVE);
  const canCancel = can(PERMISSIONS.PURCHASING_CANCEL);

  const [headerOpen, setHeaderOpen] = React.useState(false);
  const [addItemOpen, setAddItemOpen] = React.useState(false);
  const [editItem, setEditItem] = React.useState<PurchaseOrderItem | null>(null);
  const [removeItemId, setRemoveItemId] = React.useState<string | null>(null);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [orderOpen, setOrderOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');

  const [notes, setNotes] = React.useState('');
  const [orderDate, setOrderDate] = React.useState('');
  const [expectedAt, setExpectedAt] = React.useState('');
  const [purchaseType, setPurchaseType] = React.useState<PurchaseCommercialType>('CASH');
  const [paymentTermType, setPaymentTermType] =
    React.useState<PaymentTermType>('IMMEDIATE');
  const [netDays, setNetDays] = React.useState('');
  const [fixedDueDate, setFixedDueDate] = React.useState('');
  const [paymentTermsNote, setPaymentTermsNote] = React.useState('');
  const [referenceFxToman, setReferenceFxToman] = React.useState('');
  const [referenceFxRateAt, setReferenceFxRateAt] = React.useState('');

  const [newSku, setNewSku] = React.useState<SkuPickerSelection | null>(null);
  const [newQty, setNewQty] = React.useState('1');
  const [newPrice, setNewPrice] = React.useState('');
  const [editQty, setEditQty] = React.useState('');
  const [editPrice, setEditPrice] = React.useState('');

  const [costOpen, setCostOpen] = React.useState(false);
  const [voidCost, setVoidCost] = React.useState<PurchaseOrderCost | null>(null);
  const [voidReason, setVoidReason] = React.useState('');
  const [costType, setCostType] = React.useState<PurchaseCostType>('COURIER');
  const [costAmount, setCostAmount] = React.useState('');
  const [costCurrency, setCostCurrency] = React.useState<OfferCurrency>('IRR');
  const [costDescription, setCostDescription] = React.useState('');
  const [costDate, setCostDate] = React.useState('');
  const [costPayee, setCostPayee] = React.useState('');
  const [costReference, setCostReference] = React.useState('');

  const detailQuery = useQuery({
    queryKey: purchaseOrderKeys.detail(companyId, purchaseOrderId),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchPurchaseOrder(companyId, purchaseOrderId),
  });

  const po = detailQuery.data;

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
    await queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all(companyId) });
    await queryClient.invalidateQueries({
      queryKey: purchaseOrderKeys.detail(companyId, purchaseOrderId),
    });
    await queryClient.invalidateQueries({ queryKey: purchasingKeys.summary(companyId) });
  };

  const headerMutation = useMutation({
    mutationFn: () => {
      if (!po) throw new Error('missing');
      const body: Parameters<typeof updatePurchaseOrder>[2] = {
        notes: notes.trim() ? notes.trim() : null,
        expectedAt: expectedAt ? new Date(expectedAt).toISOString() : null,
        expectedVersion: po.version,
      };
      if (po.status === 'DRAFT') {
        body.orderDate = new Date(`${orderDate}T12:00:00`).toISOString();
        body.purchaseType = purchaseType;
        body.paymentTermsNote = paymentTermsNote.trim() ? paymentTermsNote.trim() : null;
        if (purchaseType === 'CASH') {
          body.paymentTermType = 'IMMEDIATE';
          body.netDays = null;
          body.dueDate = null;
          body.referenceFxRate = null;
          body.referenceFxBaseCurrency = null;
          body.referenceFxQuoteCurrency = null;
          body.referenceFxRateAt = null;
          body.obligationAmount = null;
          body.obligationCurrency = null;
        } else {
          body.paymentTermType = paymentTermType;
          if (paymentTermType === 'NET_DAYS') {
            const days = Number(netDays.trim());
            if (!Number.isInteger(days) || days < 1) throw new Error('netDays');
            body.netDays = days;
            body.dueDate = null;
          } else if (paymentTermType === 'FIXED_DATE') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fixedDueDate.trim())) throw new Error('fixedDue');
            body.netDays = null;
            body.dueDate = `${fixedDueDate.trim()}T12:00:00.000Z`;
          } else {
            body.netDays = null;
            body.dueDate = null;
          }
          body.referenceFxRate = null;
          body.referenceFxBaseCurrency = null;
          body.referenceFxQuoteCurrency = null;
          body.referenceFxRateAt = null;
          body.obligationAmount = null;
          body.obligationCurrency = null;
          if (purchaseType === 'FX_CREDIT') {
            const fxIrr = tomanInputToRialsString(referenceFxToman);
            if (!fxIrr) throw new Error('fxRate');
            body.referenceFxRate = fxIrr;
            body.referenceFxBaseCurrency = po.currency;
            body.referenceFxQuoteCurrency = 'IRR';
            body.referenceFxRateAt = referenceFxRateAt
              ? new Date(`${referenceFxRateAt}T12:00:00`).toISOString()
              : null;
          }
        }
      }
      return updatePurchaseOrder(companyId, purchaseOrderId, body);
    },
    onSuccess: async () => {
      toast.success('سفارش به‌روزرسانی شد.');
      setHeaderOpen(false);
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'netDays') {
        toast.error('مهلت پرداخت باید عدد صحیح مثبت باشد.');
        return;
      }
      if (error instanceof Error && error.message === 'fixedDue') {
        toast.error('تاریخ سررسید را به‌درستی وارد کنید.');
        return;
      }
      if (error instanceof Error && error.message === 'fxRate') {
        toast.error('نرخ مرجع ارز را به‌درستی وارد کنید.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const addItemMutation = useMutation({
    mutationFn: () => {
      if (!po || !newSku) throw new Error('sku');
      const quantity = Number(newQty);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
      const unitPrice = resolveUnitPrice(po.currency, newPrice);
      if (!unitPrice) throw new Error('price');
      return addPurchaseOrderItem(companyId, purchaseOrderId, {
        skuId: newSku.skuId,
        quantity,
        unitPrice,
      });
    },
    onSuccess: async () => {
      toast.success('قلم افزوده شد.');
      setAddItemOpen(false);
      setNewSku(null);
      setNewQty('1');
      setNewPrice('');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && (error.message === 'sku' || error.message === 'price' || error.message === 'quantity')) {
        toast.error('SKU، تعداد و قیمت را به‌درستی وارد کنید.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const editItemMutation = useMutation({
    mutationFn: () => {
      if (!po || !editItem) throw new Error('missing');
      const quantity = Number(editQty);
      if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('quantity');
      const unitPrice = resolveUnitPrice(po.currency, editPrice);
      if (!unitPrice) throw new Error('price');
      return updatePurchaseOrderItem(companyId, purchaseOrderId, editItem.id, {
        quantity,
        unitPrice,
      });
    },
    onSuccess: async () => {
      toast.success('قلم به‌روزرسانی شد.');
      setEditItem(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) => removePurchaseOrderItem(companyId, purchaseOrderId, itemId),
    onSuccess: async () => {
      toast.success('قلم حذف شد.');
      setRemoveItemId(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      approvePurchaseOrder(companyId, purchaseOrderId, { expectedVersion: po?.version }),
    onSuccess: async () => {
      toast.success('سفارش تأیید شد.');
      setApproveOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const orderMutation = useMutation({
    mutationFn: () =>
      markPurchaseOrderOrdered(companyId, purchaseOrderId, { expectedVersion: po?.version }),
    onSuccess: async () => {
      toast.success('سفارش به‌عنوان سفارش‌شده ثبت شد.');
      setOrderOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      cancelPurchaseOrder(companyId, purchaseOrderId, {
        expectedVersion: po?.version,
        ...(cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.success('سفارش لغو شد.');
      setCancelOpen(false);
      setCancelReason('');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const createCostMutation = useMutation({
    mutationFn: () => {
      if (costType === 'OTHER' && !costDescription.trim()) {
        throw new Error('other-description');
      }
      const amount =
        costCurrency === 'IRR'
          ? tomanInputToRialsString(costAmount)
          : costAmount.trim();
      if (!amount) throw new Error('amount');
      return createPurchaseOrderCost(companyId, purchaseOrderId, {
        type: costType,
        amount,
        currency: costCurrency,
        ...(costDescription.trim() ? { description: costDescription.trim() } : {}),
        ...(costDate ? { costDate } : {}),
        ...(costPayee.trim() ? { payeeName: costPayee.trim() } : {}),
        ...(costReference.trim() ? { reference: costReference.trim() } : {}),
      });
    },
    onSuccess: async () => {
      toast.success('هزینه خرید ثبت شد.');
      setCostOpen(false);
      setCostAmount('');
      setCostDescription('');
      setCostPayee('');
      setCostReference('');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'other-description') {
        toast.error('برای نوع «سایر» شرح هزینه الزامی است.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const removeCostMutation = useMutation({
    mutationFn: (costId: string) => removePurchaseOrderCost(companyId, purchaseOrderId, costId),
    onSuccess: async () => {
      toast.success('هزینه حذف شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const voidCostMutation = useMutation({
    mutationFn: () => {
      if (!voidCost || !voidReason.trim()) throw new Error('void-reason');
      return voidPurchaseOrderCost(companyId, purchaseOrderId, voidCost.id, voidReason.trim());
    },
    onSuccess: async () => {
      toast.success('هزینه باطل شد.');
      setVoidCost(null);
      setVoidReason('');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'void-reason') {
        toast.error('دلیل ابطال الزامی است.');
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  if (!can(PERMISSIONS.PURCHASING_READ)) {
    return <AccessDenied />;
  }

  if (detailQuery.isPending) return <PageSkeleton />;
  if (detailQuery.isError || !po) {
    return (
      <ErrorState
        message={mapBusinessError(detailQuery.error)}
        onRetry={() => detailQuery.refetch()}
      />
    );
  }

  const supplierDisplay = po.supplierNameSnapshot ?? po.supplier.name;
  const isDraft = po.status === 'DRAFT';
  const isApproved = po.status === 'APPROVED';
  const isOrdered = po.status === 'ORDERED';
  const isCancelled = po.status === 'CANCELLED';
  const actions = new Set(po.availableActions ?? []);
  const canEditHeader = actions.has('EDIT') || (canManage && (isApproved || isOrdered));
  const canEditItems = actions.has('EDIT');
  const canMutateCosts = actions.has('ADD_COST');
  const costs = po.purchaseCosts ?? [];
  const costTotals = po.purchaseCostTotalsByCurrency ?? [];
  const priceLabel = po.currency === 'IRR' ? 'قیمت واحد (تومان)' : 'قیمت واحد (دلار)';
  const cancelReasonRequired = !isDraft;

  return (
    <div className="space-y-6">
      <PageHeader
        title={po.number}
        description="چرخه عمر خرید — تأیید داخلی جدا از ثبت سفارش نزد تأمین‌کننده است. دریافت کالا در فاز انبار."
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'سفارش‌های خرید', href: ROUTES.purchasingOrders },
          { label: po.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge className={purchaseOrderStatusBadgeClass(po.status)}>
              {purchaseOrderStatusLabel(po.status)}
              <span className="ms-1 font-mono text-[10px] opacity-70" dir="ltr">
                {po.status}
              </span>
            </Badge>
            {canEditHeader ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNotes(po.notes ?? '');
                  setOrderDate(toDateInput(po.orderDate));
                  setExpectedAt(toDatetimeLocal(po.expectedAt));
                  setPurchaseType(po.purchaseType ?? 'CASH');
                  setPaymentTermType(po.paymentTermType ?? 'IMMEDIATE');
                  setNetDays(po.netDays != null ? String(po.netDays) : '');
                  setFixedDueDate(toDateInput(po.dueDate));
                  setPaymentTermsNote(po.paymentTermsNote ?? '');
                  setReferenceFxToman(
                    po.referenceFxRate ? rialsStringToTomanDisplay(po.referenceFxRate) : '',
                  );
                  setReferenceFxRateAt(toDateInput(po.referenceFxRateAt));
                  setHeaderOpen(true);
                }}
              >
                {isDraft ? 'ویرایش' : 'یادداشت / انتظار'}
              </Button>
            ) : null}
            {canEditItems ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewSku(null);
                  setNewQty('1');
                  setNewPrice('');
                  setAddItemOpen(true);
                }}
              >
                افزودن قلم
              </Button>
            ) : null}
            {canApprove && actions.has('APPROVE') ? (
              <Button type="button" onClick={() => setApproveOpen(true)}>
                تأیید خرید
              </Button>
            ) : null}
            {canManage && actions.has('ORDER') ? (
              <Button type="button" onClick={() => setOrderOpen(true)}>
                ثبت سفارش به تأمین‌کننده
              </Button>
            ) : null}
            {canCancel && actions.has('CANCEL') ? (
              <Button type="button" variant="danger" onClick={() => setCancelOpen(true)}>
                لغو
              </Button>
            ) : null}
            {can(PERMISSIONS.PURCHASING_RETURN_CREATE) &&
            (isOrdered || po.status === 'PARTIALLY_RECEIVED' || po.status === 'RECEIVED') ? (
              <Link
                href={purchasingReturnNewPath(po.id)}
                className={buttonVariants({ variant: 'outline' })}
              >
                ثبت برگشت
              </Link>
            ) : null}
          </div>
        }
      />

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="تأمین‌کننده">
          <Link
            href={purchasingSupplierPath(po.supplierId)}
            className="underline-offset-2 hover:underline"
          >
            {supplierDisplay}
          </Link>
          {po.supplierCodeSnapshot || po.supplier.code ? (
            <span className="ms-2 font-mono text-xs text-slate-500" dir="ltr">
              {po.supplierCodeSnapshot ?? po.supplier.code}
            </span>
          ) : null}
        </Field>
        <Field label="مخاطب">
          {po.supplierContact?.name ?? '—'}
        </Field>
        <Field label="ارز">
          <span dir="ltr">{po.currency}</span>
        </Field>
        <Field label="تاریخ سفارش (کسب‌وکار)">{formatDateTime(po.orderDate)}</Field>
        <Field label="مرجع تأمین‌کننده">
          {po.supplierOrderReference ? (
            <span dir="ltr">{po.supplierOrderReference}</span>
          ) : (
            '—'
          )}
        </Field>
        <Field label="انتظار دریافت">
          {po.expectedAt ? formatDateTime(po.expectedAt) : '—'}
        </Field>
        <Field label="مبلغ کل">
          <OfferPriceDisplay unitPrice={po.total} currency={po.currency} />
        </Field>
        <Field label="یادداشت">
          <span className="whitespace-pre-wrap">{po.notes?.trim() ? po.notes : '—'}</span>
        </Field>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">چرخه عمر</h2>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="mt-0.5 text-emerald-600" aria-hidden>
              ✓
            </span>
            <div>
              <div className="font-medium text-slate-900">ایجاد شد</div>
              <div className="text-xs text-slate-500">
                {formatDateTime(po.createdAt)} — {po.createdBy.displayName}
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span
              className={`mt-0.5 ${po.approvedAt ? 'text-emerald-600' : 'text-slate-300'}`}
              aria-hidden
            >
              {po.approvedAt ? '✓' : '○'}
            </span>
            <div>
              <div className="font-medium text-slate-900">تأیید شد</div>
              <div className="text-xs text-slate-500">
                {po.approvedAt
                  ? `${formatDateTime(po.approvedAt)} — ${po.approvedBy?.displayName ?? '—'}`
                  : 'در انتظار تأیید داخلی'}
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span
              className={`mt-0.5 ${po.orderedAt ? 'text-emerald-600' : 'text-slate-300'}`}
              aria-hidden
            >
              {po.orderedAt ? '✓' : '○'}
            </span>
            <div>
              <div className="font-medium text-slate-900">سفارش داده شد</div>
              <div className="text-xs text-slate-500">
                {po.orderedAt
                  ? `${formatDateTime(po.orderedAt)} — ${po.orderedBy?.displayName ?? '—'}`
                  : 'هنوز نزد تأمین‌کننده ثبت نشده'}
              </div>
            </div>
          </li>
          {isCancelled ? (
            <li className="flex gap-3">
              <span className="mt-0.5 text-rose-600" aria-hidden>
                ✕
              </span>
              <div>
                <div className="font-medium text-rose-800">لغو شد</div>
                <div className="text-xs text-slate-500">
                  {formatDateTime(po.cancelledAt)} — {po.cancelledBy?.displayName ?? '—'}
                </div>
                {po.cancellationReason ? (
                  <div className="mt-1 text-xs text-slate-700">علت: {po.cancellationReason}</div>
                ) : null}
              </div>
            </li>
          ) : (
            <li className="flex gap-3">
              <span className="mt-0.5 text-slate-300" aria-hidden>
                ○
              </span>
              <div>
                <div className="font-medium text-slate-900">دریافت کالا</div>
                <div className="text-xs text-slate-500">
                  دریافت کالا در فاز انبار ثبت خواهد شد.
                </div>
              </div>
            </li>
          )}
        </ol>
        {isOrdered ? (
          <p className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            این خرید نزد تأمین‌کننده ثبت شده است. موجودی انبار هنوز تغییر نکرده؛ دریافت کالا در فاز
            انبار ثبت خواهد شد.
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">شرایط تجاری</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="نوع خرید">{purchaseTypeLabel(po.purchaseType)}</Field>
          {po.purchaseType !== 'FX_CREDIT' ? (
            <Field label="مبلغ تعهد (ارز سفارش)">
              <OfferPriceDisplay unitPrice={po.total} currency={po.currency} />
            </Field>
          ) : null}
          {po.purchaseType === 'CASH' ? (
            <Field label="نکته">
              نقدی به‌معنای شیوه تسویه تجاری است — اثبات پرداخت نیست.
            </Field>
          ) : null}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">شرایط پرداخت</h2>
        <p className="text-xs text-slate-500">
          سررسید قراردادی است — به‌معنای پرداخت‌نشده بودن یا مانده بدهی نیست.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="شرایط پرداخت">
            {paymentTermsSummary(po.paymentTermType, po.netDays)}
          </Field>
          {po.termBasis ? (
            <Field label="مبنای مهلت">
              {po.termBasis === 'ORDER_DATE' ? 'تاریخ سفارش' : po.termBasis}
            </Field>
          ) : null}
          {po.dueDate ? (
            <Field label="سررسید">
              <span dir="ltr">{formatDateTime(po.dueDate)}</span>
            </Field>
          ) : (
            <Field label="سررسید">—</Field>
          )}
          <Field label="وضعیت سررسید">
            <Badge className={purchaseDueStatusBadgeClass(po.dueStatus)}>
              {purchaseDueStatusLabel(po.dueStatus)}
            </Badge>
          </Field>
          {po.paymentTermsNote ? (
            <Field label="یادداشت شرایط">
              <span className="whitespace-pre-wrap">{po.paymentTermsNote}</span>
            </Field>
          ) : null}
        </div>
      </section>

      {po.purchaseType === 'FX_CREDIT' ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">خرید ارزی</h2>
          <p className="text-xs text-slate-600">
            مبنای تسویه این خرید، مبلغ بدهی ارزی است. نرخ مرجع صرفاً نرخ ثبت‌شده در زمان خرید است.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="بدهی ارزی">
              {po.obligationAmount && po.obligationCurrency ? (
                <span className="text-lg font-bold tabular-nums tracking-tight" dir="ltr">
                  {formatGroupedDigits(po.obligationAmount)} {po.obligationCurrency}
                </span>
              ) : (
                <span className="text-sm text-slate-500">پس از تأیید از جمع سفارش محاسبه می‌شود</span>
              )}
            </Field>
            <Field label="نرخ مرجع هنگام خرید">
              {po.referenceFxRate ? (
                <span dir="ltr">
                  {formatGroupedDigits(rialsStringToTomanDisplay(po.referenceFxRate))} تومان /{' '}
                  {po.referenceFxBaseCurrency ?? po.obligationCurrency ?? po.currency}
                </span>
              ) : (
                '—'
              )}
            </Field>
            <Field label="ارزش ریالی بر اساس نرخ مرجع خرید">
              {po.referenceLocalValuation && po.referenceLocalValuationCurrency ? (
                <span className="text-sm text-slate-700">
                  <OfferPriceDisplay
                    unitPrice={po.referenceLocalValuation}
                    currency={po.referenceLocalValuationCurrency}
                  />
                </span>
              ) : (
                '—'
              )}
            </Field>
            {po.referenceFxRateAt ? (
              <Field label="تاریخ نرخ مرجع">
                <span dir="ltr">{formatDateTime(po.referenceFxRateAt)}</span>
              </Field>
            ) : null}
            {po.netDays != null ? <Field label="مهلت پرداخت">{`${po.netDays} روز`}</Field> : null}
            {po.dueDate ? (
              <Field label="سررسید">
                <span dir="ltr">{formatDateTime(po.dueDate)}</span>
              </Field>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">هزینه‌های خرید</h2>
            <p className="text-xs text-slate-500">
              ثبت هزینه ≠ پرداخت. تخصیص به موجودی/FIFO انجام نشده است.
            </p>
          </div>
          {canMutateCosts ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCostType('COURIER');
                setCostCurrency(po.currency === 'USD' ? 'IRR' : po.currency);
                setCostDate(po.orderDate.slice(0, 10));
                setCostOpen(true);
              }}
            >
              + ثبت هزینه خرید
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="ارزش کالا">
            <OfferPriceDisplay unitPrice={po.total} currency={po.currency} />
          </Field>
          <Field label="هزینه‌های خرید (فعال)">
            {costTotals.length === 0 ? (
              '—'
            ) : (
              <div className="space-y-1">
                {costTotals.map((row) => (
                  <div key={row.currency}>
                    <OfferPriceDisplay unitPrice={row.amount} currency={row.currency} />
                  </div>
                ))}
              </div>
            )}
          </Field>
          {po.referenceAcquisitionTotal ? (
            <Field label="جمع مرجع خرید">
              <OfferPriceDisplay
                unitPrice={po.referenceAcquisitionTotal.amount}
                currency={po.referenceAcquisitionTotal.currency}
              />
            </Field>
          ) : (
            <Field label="جمع مرجع خرید">
              <span className="text-xs text-slate-500">
                به‌خاطر ارزهای مختلف، جمع واحد محاسبه نمی‌شود.
              </span>
            </Field>
          )}
        </div>

        <div className="overflow-x-auto rounded-md border border-slate-100">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">نوع</th>
                <th className="px-3 py-2 text-start font-medium">شرح</th>
                <th className="px-3 py-2 text-start font-medium">مبلغ</th>
                <th className="px-3 py-2 text-start font-medium">تاریخ</th>
                <th className="px-3 py-2 text-start font-medium">طرف هزینه</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                {canMutateCosts ? (
                  <th className="px-3 py-2 text-start font-medium">اقدامات</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {costs.length === 0 ? (
                <tr>
                  <td
                    colSpan={canMutateCosts ? 7 : 6}
                    className="px-3 py-4 text-center text-slate-500"
                  >
                    هنوز هزینه خریدی ثبت نشده است.
                  </td>
                </tr>
              ) : (
                costs.map((cost) => (
                  <tr key={cost.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2">{purchaseCostTypeLabel(cost.type)}</td>
                    <td className="px-3 py-2 text-slate-700">
                      {cost.description ?? '—'}
                      {cost.reference ? (
                        <div className="text-xs text-slate-500" dir="ltr">
                          {cost.reference}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <OfferPriceDisplay unitPrice={cost.amount} currency={cost.currency} />
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {formatDateTime(cost.costDate)}
                    </td>
                    <td className="px-3 py-2">{cost.payeeName ?? '—'}</td>
                    <td className="px-3 py-2">
                      <Badge
                        className={
                          cost.status === 'VOIDED'
                            ? 'border-rose-200 bg-rose-50 text-rose-800'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        }
                      >
                        {purchaseCostStatusLabel(cost.status)}
                      </Badge>
                    </td>
                    {canMutateCosts ? (
                      <td className="px-3 py-2">
                        {isDraft && cost.status === 'ACTIVE' ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeCostMutation.mutate(cost.id)}
                          >
                            حذف
                          </Button>
                        ) : null}
                        {!isDraft && cost.status === 'ACTIVE' ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setVoidCost(cost);
                              setVoidReason('');
                            }}
                          >
                            ابطال
                          </Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">اقلام ({po.itemCount})</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">SKU</th>
                <th className="px-3 py-2 text-start font-medium">محصول</th>
                <th className="px-3 py-2 text-start font-medium">تعداد</th>
                <th className="px-3 py-2 text-start font-medium">کسری بسته‌شده</th>
                <th className="px-3 py-2 text-start font-medium">قیمت واحد</th>
                <th className="px-3 py-2 text-start font-medium">جمع ردیف</th>
                <th className="px-3 py-2 text-start font-medium">استعلام</th>
                {canEditItems ? (
                  <th className="px-3 py-2 text-start font-medium">اقدامات</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {po.items.map((item) => {
                const quoted = item.supplierOffer?.unitPrice;
                const differs = quoted && quoted !== item.unitPrice;
                return (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="px-3 py-2">
                      <Link
                        href={catalogSkuPath(item.skuId)}
                        className="font-mono underline-offset-2 hover:underline"
                        dir="ltr"
                      >
                        {itemSkuCode(item)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-800">
                      {itemDisplayName(item)}
                      {item.variantLabelSnapshot ? (
                        <div className="text-xs text-slate-500">{item.variantLabelSnapshot}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {item.quantity}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600" dir="ltr">
                      {item.closedUnfulfilledQuantity ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      <OfferPriceDisplay unitPrice={item.unitPrice} currency={po.currency} />
                    </td>
                    <td className="px-3 py-2">
                      <OfferPriceDisplay unitPrice={item.lineSubtotal} currency={po.currency} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {item.supplierOfferId && item.supplierOffer ? (
                        <div className="space-y-1">
                          <Link
                            href={purchasingOfferPath(item.supplierOfferId)}
                            className="underline-offset-2 hover:underline"
                          >
                            مشاهده استعلام
                          </Link>
                          <div>
                            استعلام:{' '}
                            <OfferPriceDisplay
                              unitPrice={item.supplierOffer.unitPrice}
                              currency={item.supplierOffer.currency}
                            />
                          </div>
                          {differs ? (
                            <div className="text-amber-800">قیمت سفارش با استعلام متفاوت است.</div>
                          ) : null}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    {canEditItems ? (
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setEditItem(item);
                              setEditQty(String(item.quantity));
                              setEditPrice(
                                po.currency === 'IRR'
                                  ? rialsStringToTomanDisplay(item.unitPrice)
                                  : item.unitPrice,
                              );
                            }}
                          >
                            ویرایش
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setRemoveItemId(item.id)}
                          >
                            حذف
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end text-sm font-medium text-slate-900">
          جمع:{' '}
          <span className="ms-2">
            <OfferPriceDisplay unitPrice={po.subtotal} currency={po.currency} />
          </span>
        </div>
      </section>

      {!isDraft && !isCancelled ? (
        <PurchaseOrderPostCommitPanel purchaseOrder={po} />
      ) : null}

      {(isOrdered ||
        po.status === 'PARTIALLY_RECEIVED' ||
        po.status === 'RECEIVED') && (
        <PurchaseOrderReceivingPanel purchaseOrder={po} />
      )}

      <PurchaseOrderActivity purchaseOrderId={purchaseOrderId} />

      <Dialog
        open={headerOpen}
        onOpenChange={setHeaderOpen}
        title="ویرایش سربرگ"
        description={
          isDraft
            ? 'در پیش‌نویس می‌توانید نوع خرید، مهلت، نرخ مرجع، تاریخ و یادداشت را تغییر دهید.'
            : 'پس از تأیید فقط یادداشت و تاریخ انتظار قابل ویرایش است.'
        }
      >
        <div className="space-y-3">
          {isDraft ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="edit-purchase-type">نوع خرید</Label>
                <select
                  id="edit-purchase-type"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={purchaseType}
                  onChange={(event) => {
                    const next = event.target.value as PurchaseCommercialType;
                    if (
                      next !== purchaseType &&
                      (netDays.trim() || referenceFxToman.trim()) &&
                      !window.confirm(
                        'تغییر نوع خرید شرایط ناسازگار را پاک می‌کند. ادامه؟',
                      )
                    ) {
                      return;
                    }
                    setPurchaseType(next);
                    if (next === 'CASH') {
                      setPaymentTermType('IMMEDIATE');
                      setNetDays('');
                      setFixedDueDate('');
                      setReferenceFxToman('');
                      setReferenceFxRateAt('');
                    } else {
                      setPaymentTermType(
                        paymentTermType === 'IMMEDIATE' ? 'NET_DAYS' : paymentTermType,
                      );
                    }
                    if (next === 'TERM_CREDIT') {
                      setReferenceFxToman('');
                      setReferenceFxRateAt('');
                    }
                  }}
                >
                  <option value="CASH">نقدی</option>
                  <option value="TERM_CREDIT">اعتباری ریالی</option>
                  <option value="FX_CREDIT">اعتباری ارزی</option>
                </select>
              </div>
              {purchaseType === 'TERM_CREDIT' || purchaseType === 'FX_CREDIT' ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="edit-payment-term">شرایط پرداخت</Label>
                    <select
                      id="edit-payment-term"
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
                      <Label htmlFor="edit-net-days">مدت پرداخت (روز)</Label>
                      <Input
                        id="edit-net-days"
                        dir="ltr"
                        inputMode="numeric"
                        value={netDays}
                        onChange={(event) => setNetDays(event.target.value)}
                      />
                      <div className="flex flex-wrap gap-1">
                        {NET_DAY_PRESETS.map((days) => (
                          <button
                            key={days}
                            type="button"
                            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs"
                            onClick={() => setNetDays(String(days))}
                          >
                            {days} روز
                          </button>
                        ))}
                      </div>
                      {previewDueDateFromOrderDate(orderDate, Number(netDays)) ? (
                        <p className="text-xs text-slate-500" dir="ltr">
                          پیش‌نمایش سررسید:{' '}
                          {previewDueDateFromOrderDate(orderDate, Number(netDays))}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {paymentTermType === 'FIXED_DATE' ? (
                    <div className="space-y-1">
                      <Label htmlFor="edit-fixed-due">تاریخ سررسید</Label>
                      <Input
                        id="edit-fixed-due"
                        type="date"
                        dir="ltr"
                        value={fixedDueDate}
                        onChange={(event) => setFixedDueDate(event.target.value)}
                      />
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    <Label htmlFor="edit-terms-note">یادداشت شرایط پرداخت</Label>
                    <Input
                      id="edit-terms-note"
                      value={paymentTermsNote}
                      onChange={(event) => setPaymentTermsNote(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
              {purchaseType === 'FX_CREDIT' ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="edit-fx-rate">نرخ مرجع (تومان / {po.currency})</Label>
                    <Input
                      id="edit-fx-rate"
                      dir="ltr"
                      inputMode="numeric"
                      value={referenceFxToman}
                      onChange={(event) => setReferenceFxToman(event.target.value)}
                    />
                    <p className="text-xs text-slate-500">
                      مبنای تسویه این خرید، مبلغ بدهی ارزی است. نرخ مرجع صرفاً نرخ ثبت‌شده در زمان
                      خرید است.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-fx-rate-at">تاریخ نرخ مرجع (اختیاری)</Label>
                    <Input
                      id="edit-fx-rate-at"
                      type="date"
                      dir="ltr"
                      value={referenceFxRateAt}
                      onChange={(event) => setReferenceFxRateAt(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor="edit-order-date">تاریخ سفارش</Label>
                <Input
                  id="edit-order-date"
                  type="date"
                  dir="ltr"
                  value={orderDate}
                  onChange={(event) => setOrderDate(event.target.value)}
                />
              </div>
            </>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="edit-expected">تاریخ انتظار دریافت</Label>
            <Input
              id="edit-expected"
              type="datetime-local"
              dir="ltr"
              value={expectedAt}
              onChange={(event) => setExpectedAt(event.target.value)}
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setHeaderOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={headerMutation.isPending}
              onClick={() => headerMutation.mutate()}
            >
              ذخیره
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={addItemOpen}
        onOpenChange={setAddItemOpen}
        title="افزودن قلم"
        description="فقط در وضعیت پیش‌نویس"
      >
        <div className="space-y-3">
          <SkuLookupPicker value={newSku} onChange={setNewSku} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="add-qty">تعداد</Label>
              <Input
                id="add-qty"
                dir="ltr"
                value={newQty}
                onChange={(event) => setNewQty(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-price">{priceLabel}</Label>
              <Input
                id="add-price"
                dir="ltr"
                value={newPrice}
                onChange={(event) => setNewPrice(event.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddItemOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={addItemMutation.isPending}
              onClick={() => addItemMutation.mutate()}
            >
              افزودن
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(editItem)}
        onOpenChange={(open) => {
          if (!open) setEditItem(null);
        }}
        title="ویرایش قلم"
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="edit-qty">تعداد</Label>
              <Input
                id="edit-qty"
                dir="ltr"
                value={editQty}
                onChange={(event) => setEditQty(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-price">{priceLabel}</Label>
              <Input
                id="edit-price"
                dir="ltr"
                value={editPrice}
                onChange={(event) => setEditPrice(event.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditItem(null)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={editItemMutation.isPending}
              onClick={() => editItemMutation.mutate()}
            >
              ذخیره
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(removeItemId)}
        onOpenChange={(open) => {
          if (!open) setRemoveItemId(null);
        }}
        title="حذف قلم از پیش‌نویس"
        description="این قلم از سفارش حذف می‌شود."
        confirmLabel="حذف"
        danger
        loading={removeItemMutation.isPending}
        onConfirm={() => {
          if (removeItemId) removeItemMutation.mutate(removeItemId);
        }}
      />

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="تأیید خرید"
        description={`تأیید داخلی این خرید: ${supplierDisplay} · ${po.itemCount} قلم · جمع ${po.total} ${po.currency} · ${purchaseTypeLabel(po.purchaseType)}${po.dueDate ? ` · سررسید ${formatDateTime(po.dueDate)}` : ''}. بعد از تأیید، اطلاعات اصلی تجاری خرید فقط از طریق فرآیند اصلاح قابل تغییر خواهند بود.`}
        target={po.number}
        confirmLabel="تأیید خرید"
        loading={approveMutation.isPending}
        onConfirm={() => approveMutation.mutate()}
      />

      <ConfirmDialog
        open={orderOpen}
        onOpenChange={setOrderOpen}
        title="ثبت سفارش به تأمین‌کننده"
        description="با ثبت «سفارش داده شد»، این خرید به‌عنوان سفارش ثبت‌شده نزد تأمین‌کننده در نظر گرفته می‌شود. موجودی انبار تغییر نمی‌کند."
        target={po.number}
        confirmLabel="ثبت سفارش"
        loading={orderMutation.isPending}
        onConfirm={() => orderMutation.mutate()}
      />

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="لغو سفارش خرید">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            سفارش لغو می‌شود و تاریخچه (اقلام، شرایط، هزینه‌ها) باقی می‌ماند.
            {cancelReasonRequired
              ? ' علت لغو برای سفارش‌های تأییدشده یا سفارش‌داده‌شده الزامی است.'
              : ' علت لغو برای پیش‌نویس اختیاری است.'}
          </p>
          <div className="space-y-1">
            <Label htmlFor="cancel-reason">
              علت لغو{cancelReasonRequired ? ' *' : ''}
            </Label>
            <textarea
              id="cancel-reason"
              className={textareaClassName}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="مثلاً تأمین‌کننده موجودی نداشت"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={
                cancelMutation.isPending ||
                (cancelReasonRequired && !cancelReason.trim())
              }
              onClick={() => cancelMutation.mutate()}
            >
              لغو سفارش
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={costOpen} onOpenChange={setCostOpen} title="ثبت هزینه خرید">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            این هزینه تجاری ثبت می‌شود؛ پرداخت یا تخصیص موجودی انجام نمی‌شود.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cost-type">نوع هزینه</Label>
              <select
                id="cost-type"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={costType}
                onChange={(event) => setCostType(event.target.value as PurchaseCostType)}
              >
                {COST_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {purchaseCostTypeLabel(type)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-currency">ارز</Label>
              <select
                id="cost-currency"
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={costCurrency}
                onChange={(event) => setCostCurrency(event.target.value as OfferCurrency)}
              >
                <option value="IRR">تومان (IRR)</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-amount">
                {costCurrency === 'IRR' ? 'مبلغ (تومان)' : 'مبلغ (دلار)'}
              </Label>
              <Input
                id="cost-amount"
                dir="ltr"
                inputMode="decimal"
                value={costAmount}
                onChange={(event) => setCostAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-date">تاریخ هزینه</Label>
              <Input
                id="cost-date"
                type="date"
                dir="ltr"
                value={costDate}
                onChange={(event) => setCostDate(event.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="cost-description">
                شرح {costType === 'OTHER' ? '(الزامی)' : '(اختیاری)'}
              </Label>
              <Input
                id="cost-description"
                value={costDescription}
                onChange={(event) => setCostDescription(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-payee">دریافت‌کننده / طرف هزینه</Label>
              <Input
                id="cost-payee"
                value={costPayee}
                onChange={(event) => setCostPayee(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-ref">مرجع / شماره رسید</Label>
              <Input
                id="cost-ref"
                value={costReference}
                onChange={(event) => setCostReference(event.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCostOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={createCostMutation.isPending}
              onClick={() => createCostMutation.mutate()}
            >
              ثبت
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(voidCost)}
        onOpenChange={(open) => {
          if (!open) {
            setVoidCost(null);
            setVoidReason('');
          }
        }}
        title="ابطال هزینه خرید"
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            ردیف هزینه برای تاریخچه باقی می‌ماند و از جمع فعال حذف می‌شود.
          </p>
          <div className="space-y-1">
            <Label htmlFor="void-cost-reason">دلیل ابطال</Label>
            <textarea
              id="void-cost-reason"
              className={textareaClassName}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="مثلاً ثبت مبلغ اشتباه"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setVoidCost(null);
                setVoidReason('');
              }}
            >
              انصراف
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={voidCostMutation.isPending}
              onClick={() => voidCostMutation.mutate()}
            >
              ابطال
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
