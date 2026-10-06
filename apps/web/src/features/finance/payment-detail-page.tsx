'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AccessDenied,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  cancelPayment,
  fetchPayment,
  fetchPaymentSettlements,
  postPayment,
  reversePayment,
  reverseSettlementAllocation,
  settlePaymentLiabilities,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financePaymentKeys, financeSettlementKeys, financeDashboardKeys } from '@/lib/query/keys';
import { FinanceEntityHistory } from '@/features/finance/finance-entity-history';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function PaymentDetailPageClient({ paymentId }: { paymentId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_PAYMENTS_READ);
  const canCreate = can(PERMISSIONS.FINANCE_PAYMENTS_CREATE);
  const canSettleRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);
  const canSettle = can(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE);
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [payableId, setPayableId] = React.useState('');
  const [liabilityAmount, setLiabilityAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: financePaymentKeys.detail(companyId, paymentId),
    queryFn: () => fetchPayment(companyId, paymentId),
    enabled: Boolean(companyId) && canRead,
  });

  const settlementsQuery = useQuery({
    queryKey: financePaymentKeys.settlements(companyId, paymentId),
    queryFn: () => fetchPaymentSettlements(companyId, paymentId),
    enabled: Boolean(companyId) && canSettleRead && detailQuery.isSuccess,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: financePaymentKeys.all(companyId) });
    void queryClient.invalidateQueries({ queryKey: financeDashboardKeys.all(companyId) });
  };

  const postMutation = useMutation({
    mutationFn: () => postPayment(companyId, paymentId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'پست ناموفق بود.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPayment(companyId, paymentId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'لغو ناموفق بود.');
    },
  });

  const reverseMutation = useMutation({
    mutationFn: () => reversePayment(companyId, paymentId, reason.trim()),
    onSuccess: () => {
      setError(null);
      setReason('');
      invalidate();
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'برگشت ناموفق بود.');
    },
  });

  const settleMutation = useMutation({
    mutationFn: () =>
      settlePaymentLiabilities(companyId, paymentId, {
        lines: [{ payableId: payableId.trim(), liabilityAmount: liabilityAmount.trim() }],
        requestId: crypto.randomUUID(),
      }),
    onSuccess: () => {
      setError(null);
      setPayableId('');
      setLiabilityAmount('');
      invalidate();
      void queryClient.invalidateQueries({
        queryKey: financePaymentKeys.settlements(companyId, paymentId),
      });
      void queryClient.invalidateQueries({
        queryKey: financeSettlementKeys.all(companyId),
      });
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'تسویه ناموفق بود.');
    },
  });

  const reverseSettleMutation = useMutation({
    mutationFn: (allocationId: string) =>
      reverseSettlementAllocation(companyId, allocationId),
    onSuccess: () => {
      setError(null);
      invalidate();
      void queryClient.invalidateQueries({
        queryKey: financePaymentKeys.settlements(companyId, paymentId),
      });
      void queryClient.invalidateQueries({
        queryKey: financeSettlementKeys.all(companyId),
      });
    },
    onError: (err) => {
      if (isApiClientError(err) && err.status === 401) handleUnauthorized();
      setError(isApiClientError(err) ? err.message : 'برگشت تسویه ناموفق بود.');
    },
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isError) {
    if (isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState message="بارگذاری پرداخت ناموفق بود." onRetry={() => detailQuery.refetch()} />
    );
  }
  if (detailQuery.isLoading || !detailQuery.data) return <TableSkeleton rows={4} />;

  const row = detailQuery.data;
  const settlements = settlementsQuery.data ?? [];

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={row.number}
        description="سند پرداخت مستقل — تسویه بدهی با تخصیص صریح (نه با پست پرداخت)"
        actions={
          <Link href={ROUTES.financePayments} className={cn(buttonVariants({ variant: 'outline' }))}>
            بازگشت
          </Link>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">وضعیت</dt>
          <dd>
            <Badge>{row.status}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">هدف</dt>
          <dd>{row.purposeType}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">مبلغ</dt>
          <dd className="tabular-nums">
            {row.amount} {row.currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">حساب</dt>
          <dd>
            {row.account.code} — {row.account.name}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">طرف مقابل</dt>
          <dd>{row.counterpartyName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">یادداشت</dt>
          <dd>{row.notes ?? '—'}</dd>
        </div>
      </dl>
      {canCreate && row.status === 'DRAFT' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              if (
                window.confirm(
                  `پست پرداخت ${row.amount} ${row.currency} از ${row.account.code}؟`,
                )
              ) {
                postMutation.mutate();
              }
            }}
            disabled={postMutation.isPending}
          >
            پست
          </Button>
          <Button
            variant="outline"
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
          >
            لغو پیش‌نویس
          </Button>
        </div>
      ) : null}
      {canCreate && row.status === 'POSTED' ? (
        <div className="space-y-2 max-w-md">
          <label className="block space-y-1 text-sm">
            <span>دلیل برگشت</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <Button
            variant="outline"
            disabled={reverseMutation.isPending || reason.trim().length === 0}
            onClick={() => {
              if (window.confirm('برگشت این پرداخت پست‌شده؟ تسویه‌ها و تاریخچه اصلی حفظ/برگشت می‌شوند.')) {
                reverseMutation.mutate();
              }
            }}
          >
            برگشت با دلیل
          </Button>
        </div>
      ) : null}

      {canSettleRead ? (
        <section className="space-y-3">
          <h2 className="text-base font-medium">تسویه بدهی تأمین‌کننده</h2>
          <p className="text-sm text-muted-foreground">
            پست پرداخت به‌تنهایی مانده بدهی را کم نمی‌کند. تخصیص صریح لازم است.
          </p>
          {settlementsQuery.isLoading ? (
            <TableSkeleton rows={2} />
          ) : settlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">هنوز تسویه‌ای ثبت نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="py-2 text-right font-medium">بدهی</th>
                    <th className="py-2 text-right font-medium">مبلغ بدهی</th>
                    <th className="py-2 text-right font-medium">مبلغ پرداخت</th>
                    <th className="py-2 text-right font-medium">وضعیت</th>
                    <th className="py-2 text-right font-medium">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id} className="border-b border-border/60">
                      <td className="py-2">
                        {s.payableNumber ?? s.payableId.slice(0, 8)}
                      </td>
                      <td className="py-2 tabular-nums">
                        {s.liabilityAmountSettled} {s.currency}
                      </td>
                      <td className="py-2 tabular-nums">
                        {s.paymentAmountApplied} {s.paymentCurrency}
                      </td>
                      <td className="py-2">
                        <Badge>{s.status}</Badge>
                      </td>
                      <td className="py-2">
                        {canSettle && s.status === 'POSTED' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={reverseSettleMutation.isPending}
                            onClick={() => {
                              if (window.confirm('برگشت این تسویه؟')) {
                                reverseSettleMutation.mutate(s.id);
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
          )}
          {canSettle && row.status === 'POSTED' ? (
            <div className="grid max-w-lg gap-2 sm:grid-cols-2">
              <label className="block space-y-1 text-sm sm:col-span-2">
                <span>شناسه بدهی (payableId)</span>
                <Input
                  value={payableId}
                  onChange={(e) => setPayableId(e.target.value)}
                  placeholder="UUID"
                />
              </label>
              <label className="block space-y-1 text-sm sm:col-span-2">
                <span>مبلغ تسویه (ارز بدهی)</span>
                <Input
                  value={liabilityAmount}
                  onChange={(e) => setLiabilityAmount(e.target.value)}
                  className="tabular-nums"
                />
              </label>
              <Button
                className="sm:col-span-2"
                disabled={
                  settleMutation.isPending ||
                  payableId.trim().length === 0 ||
                  liabilityAmount.trim().length === 0
                }
                onClick={() => settleMutation.mutate()}
              >
                ثبت تسویه
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <FinanceEntityHistory entityType="PAYMENT" entityId={paymentId} />
    </div>
  );
}
