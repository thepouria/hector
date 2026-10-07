'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SkuLookupPicker, type SkuPickerSelection } from '@/features/purchasing/sku-lookup-picker';
import {
  rialsStringToTomanDisplay,
  tomanInputToRialsString,
} from '@/features/purchasing/offer-money';
import { createSalesOrder, fetchSalesChannels, fetchSalesCustomers } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { ROUTES, salesOrderPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { SalesCurrency, SalesOrderPaymentTermType } from '@/types/sales';

type DraftLine = {
  key: string;
  sku: SkuPickerSelection | null;
  quantity: string;
  priceInput: string;
  discountInput: string;
};

function newLine(): DraftLine {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sku: null,
    quantity: '1',
    priceInput: '',
    discountInput: '0',
  };
}

export function SalesOrderCreatePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.SALES_ORDERS_CREATE);

  const [channelId, setChannelId] = React.useState('');
  const [customerId, setCustomerId] = React.useState('');
  const [currency, setCurrency] = React.useState<SalesCurrency>('IRR');
  const [paymentTermType, setPaymentTermType] =
    React.useState<SalesOrderPaymentTermType>('CASH');
  const [dueDate, setDueDate] = React.useState('');
  const [orderDiscount, setOrderDiscount] = React.useState('0');
  const [shipping, setShipping] = React.useState('0');
  const [otherCharges, setOtherCharges] = React.useState('0');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<DraftLine[]>([newLine()]);

  const channelsQuery = useQuery({
    queryKey: salesKeys.channels.list(companyId, { status: 'ACTIVE', pageSize: 100 }),
    enabled: Boolean(companyId) && canCreate,
    queryFn: () => fetchSalesChannels(companyId, { status: 'ACTIVE', pageSize: 100 }),
  });

  const customersQuery = useQuery({
    queryKey: salesKeys.customers.list(companyId, { status: 'ACTIVE', pageSize: 100 }),
    enabled: Boolean(companyId) && canCreate,
    queryFn: () => fetchSalesCustomers(companyId, { status: 'ACTIVE', pageSize: 100 }),
  });

  React.useEffect(() => {
    if (!channelId && (channelsQuery.data?.data?.length ?? 0) > 0) {
      setChannelId(channelsQuery.data!.data[0]!.id);
    }
  }, [channelId, channelsQuery.data]);

  const createMutation = useMutation({
    mutationFn: () => {
      const items = lines
        .map((line) => {
          if (!line.sku) return null;
          const qty = Number(line.quantity);
          if (!Number.isInteger(qty) || qty < 1) return null;
          const unitPrice =
            currency === 'IRR'
              ? tomanInputToRialsString(line.priceInput)
              : line.priceInput.trim();
          const discountAmount =
            currency === 'IRR'
              ? tomanInputToRialsString(line.discountInput || '0')
              : (line.discountInput.trim() || '0');
          if (!unitPrice) return null;
          return {
            skuId: line.sku.skuId,
            quantity: qty,
            unitPrice,
            discountAmount,
          };
        })
        .filter(Boolean);

      if (!channelId) throw new Error('کانال الزامی است.');
      if (items.length === 0) throw new Error('حداقل یک قلم معتبر لازم است.');

      const money = (v: string) =>
        currency === 'IRR' ? tomanInputToRialsString(v || '0') ?? '0' : v.trim() || '0';

      return createSalesOrder(companyId, {
        channelId,
        customerId: customerId || undefined,
        currency,
        paymentTermType,
        dueDate: dueDate || undefined,
        orderDiscountTotal: money(orderDiscount),
        shippingAmount: money(shipping),
        otherCharges: money(otherCharges),
        notes: notes.trim() || undefined,
        items,
      });
    },
    onSuccess: async (order) => {
      toast.success(`سفارش ${order.orderNumber} ایجاد شد`);
      await queryClient.invalidateQueries({ queryKey: salesKeys.orders.all(companyId) });
      router.push(salesOrderPath(order.id));
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!canCreate) {
    return <AccessDenied message="برای ایجاد سفارش به مجوز sales.orders.create نیاز است." />;
  }

  if (channelsQuery.isLoading) return <PageSkeleton />;
  if (channelsQuery.error) {
    return <ErrorState title="خطا" message={mapBusinessError(channelsQuery.error)} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="سفارش فروش جدید"
        description="پیش‌نویس تجاری — موجودی و مطالبه تا تأیید/تحویل ایجاد نمی‌شود"
        breadcrumbs={[
          { label: 'فروش', href: ROUTES.sales },
          { label: 'سفارش‌ها', href: ROUTES.salesOrders },
          { label: 'جدید' },
        ]}
      />

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label>کانال *</Label>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            {(channelsQuery.data?.data ?? []).map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name} ({ch.code})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>مشتری (اختیاری)</Label>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">بدون مشتری</option>
            {(customersQuery.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label>ارز</Label>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as SalesCurrency)}
          >
            <option value="IRR">ریال</option>
            <option value="USD">دلار</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>شرایط پرداخت</Label>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={paymentTermType}
            onChange={(e) => setPaymentTermType(e.target.value as SalesOrderPaymentTermType)}
          >
            <option value="CASH">نقدی</option>
            <option value="CREDIT">اعتباری</option>
            <option value="PARTIAL">جزئی</option>
          </select>
        </div>
        {(paymentTermType === 'CREDIT' || paymentTermType === 'PARTIAL') && (
          <div className="space-y-1">
            <Label>سررسید</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">اقلام</h2>
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
            افزودن قلم
          </Button>
        </div>
        {lines.map((line, index) => (
          <div key={line.key} className="grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label>SKU</Label>
              <SkuLookupPicker
                value={line.sku}
                onChange={(sku) =>
                  setLines((prev) =>
                    prev.map((l, i) => (i === index ? { ...l, sku } : l)),
                  )
                }
              />
            </div>
            <div>
              <Label>تعداد</Label>
              <Input
                value={line.quantity}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)),
                  )
                }
              />
            </div>
            <div>
              <Label>{currency === 'IRR' ? 'قیمت (تومان)' : 'قیمت (USD)'}</Label>
              <Input
                value={line.priceInput}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, i) => (i === index ? { ...l, priceInput: e.target.value } : l)),
                  )
                }
                placeholder={
                  currency === 'IRR' && line.sku
                    ? rialsStringToTomanDisplay('0')
                    : undefined
                }
              />
            </div>
            <div>
              <Label>تخفیف خط</Label>
              <Input
                value={line.discountInput}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, i) =>
                      i === index ? { ...l, discountInput: e.target.value } : l,
                    ),
                  )
                }
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={lines.length <= 1}
                onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
              >
                حذف
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
        <div className="space-y-1">
          <Label>تخفیف سفارش</Label>
          <Input value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>هزینه ارسال</Label>
          <Input value={shipping} onChange={(e) => setShipping(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>سایر هزینه‌ها</Label>
          <Input value={otherCharges} onChange={(e) => setOtherCharges(e.target.value)} />
        </div>
        <div className="space-y-1 md:col-span-3">
          <Label>یادداشت</Label>
          <textarea
            className="min-h-[72px] w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? 'در حال ذخیره…' : 'ایجاد پیش‌نویس'}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push(ROUTES.salesOrders)}>
          انصراف
        </Button>
      </div>
    </div>
  );
}
