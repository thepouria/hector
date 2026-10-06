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
  fetchSupplierPayable,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financePayableKeys } from '@/lib/query/keys';
import { financeSupplierStatementPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function PayableDetailPageClient({ payableId }: { payableId: string }) {
  const queryClient = useQueryClient();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_PAYABLES_READ);
  const canManage = can(PERMISSIONS.FINANCE_PAYABLES_MANAGE);

  const [amount, setAmount] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: financePayableKeys.detail(companyId, payableId),
    queryFn: () => fetchSupplierPayable(companyId, payableId),
    enabled: Boolean(companyId) && canRead,
  });

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

  return (
    <div className="space-y-8">
      <PageHeader
        title={payable.number}
        description="شناخت بدهی ≠ پرداخت نقدی. تخصیص فقط مانده بدهی را کم می‌کند (فاز ۴.۶ نقد)."
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

      {canAllocate ? (
        <form
          className="flex max-w-md flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            allocateMutation.mutate();
          }}
        >
          <h2 className="text-sm font-medium">تخصیص پرداخت (بدون حرکت نقد)</h2>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`مبلغ به ${payable.currency}`}
            dir="ltr"
            className="text-left"
          />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
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
    </div>
  );
}
