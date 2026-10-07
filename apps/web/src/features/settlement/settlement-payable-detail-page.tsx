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
import {
  fetchSettlementPayableSummary,
  settleSettlementPayable,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import { ROUTES, financePayablePath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SettlementPayableDetailPage() {
  const params = useParams<{ id: string }>();
  const payableId = params.id;
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);
  const canManage = can(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE);
  const queryClient = useQueryClient();

  const [paymentId, setPaymentId] = React.useState('');
  const [amount, setAmount] = React.useState('');

  const detailQuery = useQuery({
    queryKey: settlementKeys.payable(companyId, payableId),
    enabled: Boolean(companyId) && canRead && Boolean(payableId),
    queryFn: () => fetchSettlementPayableSummary(companyId, payableId),
  });

  React.useEffect(() => {
    if (detailQuery.error && isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [detailQuery.error, handleUnauthorized]);

  const settleMut = useMutation({
    mutationFn: () =>
      settleSettlementPayable(companyId, payableId, {
        paymentId: paymentId.trim(),
        amount: amount.trim(),
        requestId: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      toast.success('تخصیص پرداخت ثبت شد');
      setPaymentId('');
      setAmount('');
      await queryClient.invalidateQueries({ queryKey: settlementKeys.all(companyId) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isLoading) return <PageSkeleton />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <ErrorState
        message="بارگذاری خلاصه بدهی ناموفق بود."
        onRetry={() => detailQuery.refetch()}
      />
    );
  }

  const d = detailQuery.data as Record<string, unknown>;
  const currency = String(d.currency ?? '');
  const outstanding = String(d.outstandingAmount ?? d.outstanding ?? '0');

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={`تسویه بدهی ${String(d.number ?? payableId)}`}
        description="پرداخت از Finance انتخاب می‌شود؛ مبلغ پرداخت روی بدهی دستی ویرایش نمی‌شود."
        actions={
          <a
            href={financePayablePath(payableId)}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            جزئیات مالی بدهی
          </a>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3 rounded-lg border p-4 text-sm">
        <div>
          <div className="text-muted-foreground">مانده</div>
          <div className="tabular-nums font-semibold">
            {formatSettlementMoney(outstanding, currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">تسویه‌شده</div>
          <div className="tabular-nums">
            {formatSettlementMoney(String(d.settledAmount ?? '0'), currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">وضعیت</div>
          <div>{String(d.status ?? '—')}</div>
        </div>
      </div>

      {canManage ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">تخصیص پرداخت موجود</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="paymentId">شناسه پرداخت پست‌شده</Label>
              <Input
                id="paymentId"
                value={paymentId}
                onChange={(e) => setPaymentId(e.target.value)}
                placeholder="UUID پرداخت"
              />
            </div>
            <div>
              <Label htmlFor="amount">مبلغ تخصیص (ارز تعهد)</Label>
              <Input
                id="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={outstanding}
              />
            </div>
          </div>
          <Button
            disabled={!paymentId || !amount || settleMut.isPending}
            onClick={() => settleMut.mutate()}
          >
            تخصیص
          </Button>
          <p className="text-xs text-muted-foreground">
            در صورت خطای ظرفیت: مبلغ موجود تغییر کرده — صفحه را تازه کنید و دوباره تلاش کنید.
          </p>
        </section>
      ) : null}

      <p className="text-sm text-muted-foreground">
        <a href={ROUTES.settlementPayables} className="text-primary underline-offset-2 hover:underline">
          بازگشت به فهرست بدهی‌ها
        </a>
      </p>
    </div>
  );
}
