'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { AccessDenied, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  allocateSupplierPayment,
  fetchPayment,
  fetchSupplierPayable,
  previewSettlement,
  reverseSettlementAllocation,
  settlePayableFromPayment,
  type SettlementPreview,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import {
  financeDashboardKeys,
  financePayableKeys,
  financePaymentKeys,
  financeSettlementKeys,
} from '@/lib/query/keys';
import { financePaymentPath, financeSupplierStatementPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import { FinanceEntityHistory } from '@/features/finance/finance-entity-history';

export function PayableDetailPageClient({ payableId }: { payableId: string }) {
  const queryClient = useQueryClient();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_PAYABLES_READ);
  const canManage = can(PERMISSIONS.FINANCE_PAYABLES_MANAGE);
  const canSettleRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);
  const canSettle = can(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE);

  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const [paymentId, setPaymentId] = React.useState('');
  const [liabilityAmount, setLiabilityAmount] = React.useState('');
  const [paymentAmount, setPaymentAmount] = React.useState('');
  const [settlementRate, setSettlementRate] = React.useState('');
  const [preview, setPreview] = React.useState<SettlementPreview | null>(null);

  const query = useQuery({
    queryKey: financePayableKeys.detail(companyId, payableId),
    queryFn: () => fetchSupplierPayable(companyId, payableId),
    enabled: Boolean(companyId) && canRead,
  });

  const paymentQuery = useQuery({
    queryKey: financePaymentKeys.detail(companyId, paymentId.trim()),
    queryFn: () => fetchPayment(companyId, paymentId.trim()),
    enabled: Boolean(companyId) && canSettleRead && paymentId.trim().length > 10,
  });

  const currenciesDiffer =
    Boolean(query.data && paymentQuery.data) &&
    query.data!.currency !== paymentQuery.data!.currency;

  const allocateMutation = useMutation({
    mutationFn: () =>
      allocateSupplierPayment(companyId, payableId, {
        amount,
        currency: query.data!.currency,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setAmount('');
      setError(null);
      await queryClient.invalidateQueries({
        queryKey: financePayableKeys.detail(companyId, payableId),
      });
      await queryClient.invalidateQueries({ queryKey: financePayableKeys.list(companyId) });
      await queryClient.invalidateQueries({ queryKey: financePayableKeys.summary(companyId) });
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'تخصیص پرداخت ناموفق بود.');
    },
  });

  const buildSettleLines = () => {
    const line: {
      payableId: string;
      liabilityAmount: string;
      paymentAmount?: string;
      settlementRate?: string;
      settlementRateBaseCurrency?: string;
      settlementRateQuoteCurrency?: string;
    } = {
      payableId,
      liabilityAmount: liabilityAmount.trim(),
    };
    if (currenciesDiffer) {
      if (paymentAmount.trim()) line.paymentAmount = paymentAmount.trim();
      if (settlementRate.trim() && query.data && paymentQuery.data) {
        line.settlementRate = settlementRate.trim();
        line.settlementRateBaseCurrency = query.data.currency;
        line.settlementRateQuoteCurrency = paymentQuery.data.currency;
      }
    }
    return [line];
  };

  const previewMutation = useMutation({
    mutationFn: () =>
      previewSettlement(companyId, {
        paymentId: paymentId.trim(),
        lines: buildSettleLines(),
      }),
    onSuccess: (data) => {
      setPreview(data);
      setError(null);
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setPreview(null);
      setError(isApiClientError(err) ? err.message : 'پیش‌نمایش تسویه ناموفق بود.');
    },
  });

  const settleMutation = useMutation({
    mutationFn: () =>
      settlePayableFromPayment(companyId, payableId, {
        paymentId: paymentId.trim(),
        liabilityAmount: liabilityAmount.trim(),
        ...(currenciesDiffer && paymentAmount.trim()
          ? { paymentAmount: paymentAmount.trim() }
          : {}),
        ...(currenciesDiffer && settlementRate.trim() && query.data && paymentQuery.data
          ? {
              settlementRate: settlementRate.trim(),
              settlementRateBaseCurrency: query.data.currency,
              settlementRateQuoteCurrency: paymentQuery.data.currency,
            }
          : {}),
        requestId: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setError(null);
      setPreview(null);
      setLiabilityAmount('');
      setPaymentAmount('');
      setSettlementRate('');
      await queryClient.invalidateQueries({
        queryKey: financePayableKeys.detail(companyId, payableId),
      });
      await queryClient.invalidateQueries({ queryKey: financePayableKeys.all(companyId) });
      await queryClient.invalidateQueries({
        queryKey: financeSettlementKeys.all(companyId),
      });
      if (paymentId.trim()) {
        await queryClient.invalidateQueries({
          queryKey: financePaymentKeys.settlements(companyId, paymentId.trim()),
        });
      }
      await queryClient.invalidateQueries({ queryKey: financeDashboardKeys.all(companyId) });
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'تسویه ناموفق بود.');
    },
  });

  const reverseMutation = useMutation({
    mutationFn: (allocationId: string) =>
      reverseSettlementAllocation(companyId, allocationId),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({
        queryKey: financePayableKeys.detail(companyId, payableId),
      });
      await queryClient.invalidateQueries({ queryKey: financePayableKeys.all(companyId) });
      await queryClient.invalidateQueries({
        queryKey: financeSettlementKeys.all(companyId),
      });
      await queryClient.invalidateQueries({ queryKey: financeDashboardKeys.all(companyId) });
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'برگشت تسویه ناموفق بود.');
    },
  });

  if (!canRead) return <AccessDenied />;
  if (query.isLoading) return <TableSkeleton rows={6} />;
  if (query.isError || !query.data) {
    if (isApiClientError(query.error) && query.error.status === 401) handleUnauthorized();
    return <ErrorState message="جزئیات بدهی یافت نشد." onRetry={() => query.refetch()} />;
  }

  const payable = query.data;
  const canAllocate =
    canManage &&
    payable.status !== 'CANCELLED' &&
    payable.status !== 'PAID' &&
    Number(payable.outstandingAmount) > 0;

  const canSettleForm =
    canSettle &&
    payable.status !== 'CANCELLED' &&
    payable.status !== 'PAID' &&
    Number(payable.outstandingAmount) > 0;

  const settlementMovements =
    payable.movements?.filter((m) => m.type === 'PAYMENT_ALLOCATION') ?? [];

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title={payable.number}
        description="شناخت بدهی ≠ پرداخت نقدی. تسویه با پرداخت پست‌شده صریح است."
        actions={
          <Link
            href={ROUTES.financePayables}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            بازگشت به لیست
          </Link>
        }
      />

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">تأمین‌کننده</dt>
          <dd>
            <Link
              href={financeSupplierStatementPath(payable.supplierId)}
              className="text-primary underline-offset-2 hover:underline"
            >
              {payable.supplierName ?? payable.supplierId.slice(0, 8)}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">وضعیت</dt>
          <dd>
            <Badge>{payable.status}</Badge>
            {payable.overdue ? (
              <Badge className="mr-2 border-red-200 bg-red-50 text-red-700">سررسید گذشته</Badge>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">ارز تعهد</dt>
          <dd>{payable.currency}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">نوع خرید</dt>
          <dd>{payable.purchaseType}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">شناخته‌شده</dt>
          <dd className="tabular-nums">
            {payable.recognizedAmount} {payable.currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">مانده</dt>
          <dd className="tabular-nums">
            {payable.outstandingAmount} {payable.currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">سررسید</dt>
          <dd>{payable.dueDate ? new Date(payable.dueDate).toLocaleDateString('fa-IR') : '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">سفارش خرید</dt>
          <dd>{payable.purchaseOrderNumber ?? '—'}</dd>
        </div>
      </dl>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {canSettleForm || canSettleRead ? (
        <section className="space-y-3 rounded-lg border border-border/80 p-4">
          <h2 className="text-sm font-medium">تسویه با پرداخت (فاز ۴.۹)</h2>
          <p className="text-sm text-muted-foreground">
            پیش‌نمایش را ببینید، سپس تأیید کنید. در ارز متفاوت، مبلغ پرداخت و نرخ تسویه لازم است.
          </p>
          {canSettleForm ? (
            <div className="grid max-w-xl gap-2 sm:grid-cols-2">
              <label className="block space-y-1 text-sm sm:col-span-2">
                <span>شناسه پرداخت پست‌شده</span>
                <Input
                  value={paymentId}
                  onChange={(e) => {
                    setPaymentId(e.target.value);
                    setPreview(null);
                  }}
                  placeholder="UUID"
                  dir="ltr"
                  className="text-left"
                />
                {paymentQuery.data ? (
                  <span className="text-xs text-muted-foreground">
                    {paymentQuery.data.number} · {paymentQuery.data.amount}{' '}
                    {paymentQuery.data.currency} · {paymentQuery.data.status}
                    {paymentQuery.data.id ? (
                      <>
                        {' · '}
                        <Link
                          href={financePaymentPath(paymentQuery.data.id)}
                          className="underline-offset-2 hover:underline"
                        >
                          جزئیات پرداخت
                        </Link>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </label>
              <label className="block space-y-1 text-sm sm:col-span-2">
                <span>مبلغ تسویه (ارز بدهی)</span>
                <Input
                  value={liabilityAmount}
                  onChange={(e) => {
                    setLiabilityAmount(e.target.value);
                    setPreview(null);
                  }}
                  placeholder={payable.outstandingAmount}
                  dir="ltr"
                  className="text-left tabular-nums"
                />
              </label>
              {currenciesDiffer ? (
                <>
                  <label className="block space-y-1 text-sm sm:col-span-2">
                    <span>مبلغ از پرداخت ({paymentQuery.data?.currency})</span>
                    <Input
                      value={paymentAmount}
                      onChange={(e) => {
                        setPaymentAmount(e.target.value);
                        setPreview(null);
                      }}
                      dir="ltr"
                      className="text-left tabular-nums"
                    />
                  </label>
                  <label className="block space-y-1 text-sm sm:col-span-2">
                    <span>
                      نرخ تسویه (۱ {payable.currency} = ؟ {paymentQuery.data?.currency})
                    </span>
                    <Input
                      value={settlementRate}
                      onChange={(e) => {
                        setSettlementRate(e.target.value);
                        setPreview(null);
                      }}
                      dir="ltr"
                      className="text-left tabular-nums"
                    />
                  </label>
                </>
              ) : null}
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    previewMutation.isPending ||
                    !paymentId.trim() ||
                    !liabilityAmount.trim()
                  }
                  onClick={() => previewMutation.mutate()}
                >
                  پیش‌نمایش
                </Button>
                <Button
                  type="button"
                  disabled={
                    settleMutation.isPending ||
                    !paymentId.trim() ||
                    !liabilityAmount.trim() ||
                    !preview
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        'ثبت تسویه؟ مانده بدهی و مانده قابل‌تخصیص پرداخت به‌روز می‌شود.',
                      )
                    ) {
                      settleMutation.mutate();
                    }
                  }}
                >
                  تأیید و ثبت تسویه
                </Button>
              </div>
            </div>
          ) : null}

          {preview ? (
            <div className="overflow-x-auto rounded-md border border-border/60 p-2">
              <p className="mb-2 text-sm">
                پیش‌نمایش {preview.paymentNumber}: مانده پرداخت قبل{' '}
                <span className="tabular-nums">{preview.paymentRemainingBefore}</span> → بعد{' '}
                <span className="tabular-nums">{preview.paymentRemainingAfter}</span>{' '}
                {preview.paymentCurrency}
              </p>
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-1 text-right">بدهی</th>
                    <th className="px-2 py-1 text-right">مبلغ بدهی</th>
                    <th className="px-2 py-1 text-right">مبلغ پرداخت</th>
                    <th className="px-2 py-1 text-right">مانده بعد</th>
                    <th className="px-2 py-1 text-right">اختلاف FX پایه</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line) => (
                    <tr key={line.payableId} className="border-b border-border/50">
                      <td className="px-2 py-1">{line.payableNumber}</td>
                      <td className="px-2 py-1 tabular-nums">
                        {line.liabilityAmount} {line.liabilityCurrency}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {line.paymentAmount} {line.paymentCurrency}
                      </td>
                      <td className="px-2 py-1 tabular-nums">{line.outstandingAfter}</td>
                      <td className="px-2 py-1 tabular-nums">{line.fxDifferenceBase}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {settlementMovements.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">تخصیص‌های تسویه</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-2 py-1 text-right">مبلغ</th>
                      <th className="px-2 py-1 text-right">یادداشت</th>
                      <th className="px-2 py-1 text-right">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlementMovements.map((m) => (
                      <tr key={m.id} className="border-b border-border/50">
                        <td className="px-2 py-1 tabular-nums">
                          {m.amount} {m.currency}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground">{m.notes ?? '—'}</td>
                        <td className="px-2 py-1">
                          {canSettle ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={reverseMutation.isPending}
                              onClick={() => {
                                if (window.confirm('برگشت این تسویه؟')) {
                                  reverseMutation.mutate(m.sourceId);
                                }
                              }}
                            >
                              برگشت
                            </Button>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {canAllocate ? (
        <form
          className="flex max-w-md flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            allocateMutation.mutate();
          }}
        >
          <h2 className="text-sm font-medium">تخصیص بدون پرداخت (قدیمی / بدون حرکت نقد)</h2>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`مبلغ به ${payable.currency}`}
            dir="ltr"
            className="text-left"
          />
          <Button type="submit" disabled={!amount || allocateMutation.isPending}>
            ثبت تخصیص
          </Button>
        </form>
      ) : null}

      {payable.lines?.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">خطوط شناخت</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-right text-muted-foreground">
                  <th className="px-2 py-2 font-medium">مقدار</th>
                  <th className="px-2 py-2 font-medium">فی</th>
                  <th className="px-2 py-2 font-medium">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {payable.lines.map((line) => (
                  <tr key={line.id} className="border-b">
                    <td className="px-2 py-2 tabular-nums">{line.quantity}</td>
                    <td className="px-2 py-2 tabular-nums">{line.unitPrice}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {line.lineAmount} {line.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {payable.movements?.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">حرکات بدهی</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-right text-muted-foreground">
                  <th className="px-2 py-2 font-medium">نوع</th>
                  <th className="px-2 py-2 font-medium">جهت</th>
                  <th className="px-2 py-2 font-medium">مبلغ</th>
                  <th className="px-2 py-2 font-medium">یادداشت</th>
                </tr>
              </thead>
              <tbody>
                {payable.movements.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="px-2 py-2">{m.type}</td>
                    <td className="px-2 py-2">{m.direction}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {m.amount} {m.currency}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{m.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <FinanceEntityHistory entityType="SUPPLIER_PAYABLE" entityId={payableId} />
    </div>
  );
}
