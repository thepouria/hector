'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  channelSettlementStatusLabel,
  componentTypeLabel,
  formatSettlementMoney,
  statusBadgeClass,
} from '@/features/settlement/settlement-labels';
import {
  allocateChannelSettlementReceipt,
  fetchChannelSettlement,
  finalizeChannelSettlement,
  openReconciliation,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  settlementReconciliationPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function ChannelSettlementDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);
  const canManage = can(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE);
  const canReconcile = can(PERMISSIONS.FINANCE_RECONCILIATION_MATCH);
  const queryClient = useQueryClient();

  const [receiptId, setReceiptId] = React.useState('');
  const [amount, setAmount] = React.useState('');

  const detailQuery = useQuery({
    queryKey: settlementKeys.channel(companyId, id),
    enabled: Boolean(companyId) && canRead && Boolean(id),
    queryFn: () => fetchChannelSettlement(companyId, id),
  });

  React.useEffect(() => {
    if (detailQuery.error && isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [detailQuery.error, handleUnauthorized]);

  const finalizeMut = useMutation({
    mutationFn: () => finalizeChannelSettlement(companyId, id),
    onSuccess: async () => {
      toast.success('تسویه نهایی شد');
      await queryClient.invalidateQueries({ queryKey: settlementKeys.channel(companyId, id) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const allocateMut = useMutation({
    mutationFn: () =>
      allocateChannelSettlementReceipt(companyId, id, {
        receiptId: receiptId.trim(),
        amount: amount.trim(),
        requestId: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      toast.success('دریافت تخصیص یافت');
      setReceiptId('');
      setAmount('');
      await queryClient.invalidateQueries({ queryKey: settlementKeys.all(companyId) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const openRecMut = useMutation({
    mutationFn: () =>
      openReconciliation(companyId, {
        sourceType: 'CHANNEL',
        sourceId: id,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: (row) => {
      toast.success('پرونده مغایرت‌گیری باز شد');
      router.push(settlementReconciliationPath(row.id));
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isLoading) return <PageSkeleton />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <ErrorState message="بارگذاری تسویه کانال ناموفق بود." onRetry={() => detailQuery.refetch()} />
    );
  }

  const row = detailQuery.data;
  const bridge = row.components.map((c) => ({
    ...c,
    signed:
      c.effect === 'INCREASE'
        ? `+${formatSettlementMoney(c.amount, c.currency)}`
        : `−${formatSettlementMoney(c.amount, c.currency)}`,
  }));

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={row.number}
        description={`${row.channel?.name ?? row.channelId} · ${formatDateTime(row.periodStart)} — ${formatDateTime(row.periodEnd)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canManage && row.status === 'DRAFT' ? (
              <Button onClick={() => finalizeMut.mutate()} disabled={finalizeMut.isPending}>
                نهایی‌سازی
              </Button>
            ) : null}
            {canReconcile && row.status !== 'DRAFT' && row.status !== 'CANCELLED' ? (
              <Button
                variant="outline"
                onClick={() => openRecMut.mutate()}
                disabled={openRecMut.isPending}
              >
                باز کردن مغایرت‌گیری
              </Button>
            ) : null}
            <Link
              href={ROUTES.settlementChannels}
              className={cn(buttonVariants({ variant: 'ghost' }))}
            >
              بازگشت
            </Link>
          </div>
        }
      />

      <Badge className={statusBadgeClass(row.status)}>
        {channelSettlementStatusLabel(row.status)}
      </Badge>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">پل ناخالص → خالص</h2>
        <ul className="space-y-2 text-sm">
          {bridge.map((c) => (
            <li key={c.id} className="flex justify-between gap-4 tabular-nums">
              <span>
                {componentTypeLabel(c.type)}
                {c.description ? (
                  <span className="text-muted-foreground"> — {c.description}</span>
                ) : null}
              </span>
              <span>{c.signed}</span>
            </li>
          ))}
          <li className="flex justify-between border-t pt-2 font-semibold tabular-nums">
            <span>Expected Net</span>
            <span>{formatSettlementMoney(row.expectedNet, row.currency)}</span>
          </li>
        </ul>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 rounded-lg border p-4 text-sm">
        <div>
          <div className="text-muted-foreground">دریافت واقعی (از تخصیص Receipt)</div>
          <div className="text-lg font-semibold tabular-nums">
            {formatSettlementMoney(row.actualReceived ?? row.actualReceivedAmount ?? '0', row.currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">مانده</div>
          <div className="text-lg font-semibold tabular-nums">
            {formatSettlementMoney(row.outstandingAmount, row.currency)}
          </div>
        </div>
      </section>

      {canManage && (row.status === 'OPEN' || row.status === 'PARTIALLY_RECEIVED') ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">تخصیص دریافت Finance</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="receiptId">شناسه Receipt پست‌شده</Label>
              <Input
                id="receiptId"
                value={receiptId}
                onChange={(e) => setReceiptId(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="amount">مبلغ تخصیص</Label>
              <Input
                id="amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={row.outstandingAmount}
              />
            </div>
          </div>
          <Button
            disabled={!receiptId || !amount || allocateMut.isPending}
            onClick={() => allocateMut.mutate()}
          >
            تخصیص
          </Button>
          <p className="text-xs text-muted-foreground">
            اگر ظرفیت تغییر کرده باشد، پیام تعارض دریافت می‌کنید — تازه کنید و دوباره تلاش کنید.
          </p>
        </section>
      ) : null}
    </div>
  );
}
