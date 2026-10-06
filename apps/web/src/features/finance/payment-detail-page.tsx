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
  postPayment,
  reversePayment,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financePaymentKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function PaymentDetailPageClient({ paymentId }: { paymentId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_PAYMENTS_READ);
  const canCreate = can(PERMISSIONS.FINANCE_PAYMENTS_CREATE);
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: financePaymentKeys.detail(companyId, paymentId),
    queryFn: () => fetchPayment(companyId, paymentId),
    enabled: Boolean(companyId) && canRead,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: financePaymentKeys.all(companyId) });
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
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={row.number}
        description="سند پرداخت مستقل — حرکت حساب MONEY_OUT با sourceType=PAYMENT"
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
              if (window.confirm('برگشت این پرداخت پست‌شده؟ تاریخچه اصلی حفظ می‌شود.')) {
                reverseMutation.mutate();
              }
            }}
          >
            برگشت با دلیل
          </Button>
        </div>
      ) : null}
    </div>
  );
}
