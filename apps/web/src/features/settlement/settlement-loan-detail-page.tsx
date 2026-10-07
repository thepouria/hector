'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatSettlementMoney } from '@/features/settlement/settlement-labels';
import { fetchSettlementLoanSummary, repaySettlementLoan } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import { ROUTES, financeLoanPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SettlementLoanDetailPage() {
  const params = useParams<{ id: string }>();
  const loanId = params.id;
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);
  const canManage = can(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE);
  const queryClient = useQueryClient();

  const [paymentId, setPaymentId] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [paymentAmount, setPaymentAmount] = React.useState('');
  const [fxRate, setFxRate] = React.useState('');

  const detailQuery = useQuery({
    queryKey: settlementKeys.loan(companyId, loanId),
    enabled: Boolean(companyId) && canRead && Boolean(loanId),
    queryFn: () => fetchSettlementLoanSummary(companyId, loanId),
  });

  React.useEffect(() => {
    if (detailQuery.error && isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [detailQuery.error, handleUnauthorized]);

  const repayMut = useMutation({
    mutationFn: () =>
      repaySettlementLoan(companyId, loanId, {
        paymentId: paymentId.trim(),
        amount: amount.trim(),
        ...(paymentAmount ? { paymentAmount: paymentAmount.trim() } : {}),
        ...(fxRate ? { fxRate: fxRate.trim() } : {}),
        requestId: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      toast.success('بازپرداخت تخصیص یافت');
      setPaymentId('');
      setAmount('');
      setPaymentAmount('');
      setFxRate('');
      await queryClient.invalidateQueries({ queryKey: settlementKeys.all(companyId) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isLoading) return <PageSkeleton />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <ErrorState message="بارگذاری وام ناموفق بود." onRetry={() => detailQuery.refetch()} />
    );
  }

  const d = detailQuery.data as Record<string, unknown>;
  const currency = String(d.currency ?? '');

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={`تسویه وام ${String(d.number ?? loanId)}`}
        description="بعد اقتصادی تعهد در ارز وام است؛ مبلغ پرداخت IRR جایگزین اصل USD نمی‌شود."
        actions={
          <a
            href={financeLoanPath(loanId)}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            جزئیات وام در مالی
          </a>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 rounded-lg border p-4 text-sm">
        <div>
          <div className="text-muted-foreground">اصل</div>
          <div className="tabular-nums">
            {formatSettlementMoney(String(d.originalPrincipal ?? '0'), currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">بازپرداخت‌شده</div>
          <div className="tabular-nums">
            {formatSettlementMoney(String(d.repaidPrincipal ?? d.settledAmount ?? '0'), currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">مانده تعهد</div>
          <div className="tabular-nums font-semibold">
            {formatSettlementMoney(
              String(d.outstandingPrincipal ?? d.outstandingAmount ?? '0'),
              currency,
            )}
          </div>
        </div>
      </div>

      {canManage ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">بازپرداخت از پرداخت پست‌شده</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="paymentId">شناسه پرداخت</Label>
              <Input id="paymentId" value={paymentId} onChange={(e) => setPaymentId(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="amount">مبلغ تعهد (ارز وام)</Label>
              <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="paymentAmount">مبلغ پرداخت (اگر ارز متفاوت)</Label>
              <Input
                id="paymentAmount"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="fxRate">نرخ تسویه FX (در صورت نیاز)</Label>
              <Input id="fxRate" value={fxRate} onChange={(e) => setFxRate(e.target.value)} />
            </div>
          </div>
          <Button
            disabled={!paymentId || !amount || repayMut.isPending}
            onClick={() => repayMut.mutate()}
          >
            تخصیص بازپرداخت
          </Button>
        </section>
      ) : null}

      <a href={ROUTES.settlementLoans} className="text-sm text-primary underline-offset-2 hover:underline">
        بازگشت به فهرست وام‌ها
      </a>
    </div>
  );
}
