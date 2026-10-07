'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  formatSettlementMoney,
  channelSettlementStatusLabel,
  reconciliationStatusLabel,
  statusBadgeClass,
} from '@/features/settlement/settlement-labels';
import { fetchSettlementDashboard } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  settlementChannelPath,
  settlementLoanPath,
  settlementPayablePath,
  settlementReconciliationPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

function MoneyByCurrency({
  rows,
}: {
  rows: Array<{ currency: string; amount: string; count: number }>;
}) {
  if (!rows.length) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="space-y-1 text-sm tabular-nums">
      {rows.map((r) => (
        <li key={r.currency}>
          {formatSettlementMoney(r.amount, r.currency)}
          <span className="text-muted-foreground"> ({r.count})</span>
        </li>
      ))}
    </ul>
  );
}

function attentionHref(item: { hrefHint: string; id: string }): string {
  if (item.hrefHint === 'payables') return settlementPayablePath(item.id);
  if (item.hrefHint === 'loans') return settlementLoanPath(item.id);
  if (item.hrefHint === 'channels') return settlementChannelPath(item.id);
  if (item.hrefHint === 'reconciliation') return settlementReconciliationPath(item.id);
  return ROUTES.settlements;
}

export function SettlementDashboardPage() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);

  const q = useQuery({
    queryKey: settlementKeys.dashboard(companyId),
    enabled: Boolean(companyId) && canRead,
    staleTime: 30_000,
    queryFn: () => fetchSettlementDashboard(companyId),
  });

  React.useEffect(() => {
    if (q.error && isApiClientError(q.error) && q.error.status === 401) {
      handleUnauthorized();
    }
  }, [q.error, handleUnauthorized]);

  if (!canRead) {
    return (
      <AccessDenied message="برای مشاهده مرکز تسویه به مجوز finance.settlements.read نیاز است." />
    );
  }
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) {
    return (
      <ErrorState message="بارگذاری داشبورد تسویه ناموفق بود." onRetry={() => q.refetch()} />
    );
  }

  const d = q.data;
  const cards = [
    {
      title: 'بدهی‌های باز',
      value: String(d.kpis.openPayableCount),
      href: `${ROUTES.settlementPayables}`,
      sub: <MoneyByCurrency rows={d.outstandingPayablesByCurrency} />,
    },
    {
      title: 'سررسید گذشته',
      value: String(d.kpis.overduePayableCount),
      href: `${ROUTES.settlementPayables}?dueState=OVERDUE`,
      sub: <MoneyByCurrency rows={d.overduePayablesByCurrency} />,
    },
    {
      title: 'مانده وام',
      value: String(d.kpis.openLoanCount),
      href: ROUTES.settlementLoans,
      sub: <MoneyByCurrency rows={d.outstandingLoansByCurrency} />,
    },
    {
      title: 'تسویه کانال باز',
      value: String(d.kpis.openChannelSettlementCount),
      href: `${ROUTES.settlementChannels}?outstandingOnly=true`,
      sub: <MoneyByCurrency rows={d.expectedChannelReceiptsByCurrency} />,
    },
    {
      title: 'نیازمند تطبیق',
      value: String(d.kpis.needsMatchingCount),
      href: `${ROUTES.settlementReconciliation}?needsMatching=1`,
    },
    {
      title: 'مغایرت باز',
      value: String(d.kpis.openDiscrepancyCount),
      href: `${ROUTES.settlementReconciliation}?status=DISCREPANCY`,
    },
    {
      title: 'در حال بررسی',
      value: String(d.kpis.underReviewCount),
      href: `${ROUTES.settlementReconciliation}?status=UNDER_REVIEW`,
    },
    {
      title: 'تسویه جزئی کانال',
      value: String(d.kpis.partiallyReceivedChannelCount),
      href: `${ROUTES.settlementChannels}?status=PARTIALLY_RECEIVED`,
    },
  ] as const;

  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title="مرکز تسویه"
        description="بدهی‌ها، وام‌ها، تسویه کانال و مغایرت‌گیری — مبالغ هر ارز جداگانه است و جمع نمی‌شود."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={ROUTES.settlementChannelNew} className={cn(buttonVariants())}>
              تسویه کانال جدید
            </Link>
            <Link
              href={ROUTES.settlementReconciliation}
              className={cn(buttonVariants({ variant: 'outline' }))}
            >
              مغایرت‌گیری
            </Link>
          </div>
        }
      />

      <p className="text-xs text-muted-foreground">
        به‌روز تا {formatDateTime(d.asOf)} · مانده باز ≠ مغایرت · Finance منبع حقیقت پول است
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.title}
            href={card.href}
            className="rounded-lg border bg-background p-4 transition hover:border-primary/40"
          >
            <div className="text-sm text-muted-foreground">{card.title}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</div>
            {'sub' in card && card.sub ? <div className="mt-3">{card.sub}</div> : null}
          </Link>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">صف توجه</h2>
        {!d.attentionQueue.length ? (
          <EmptyState
            title="مورد فوری نیست"
            description="بدهی سررسید گذشته یا مغایرت باز ثبت نشده است."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-right text-muted-foreground">
                  <th className="px-3 py-2 font-medium">مورد</th>
                  <th className="px-3 py-2 font-medium">مبلغ</th>
                  <th className="px-3 py-2 font-medium">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {d.attentionQueue.map((item) => (
                  <tr key={`${item.kind}-${item.id}`} className="border-b">
                    <td className="px-3 py-2">
                      <Link
                        href={attentionHref(item)}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {item.label}
                      </Link>
                      <div className="text-xs text-muted-foreground">{item.kind}</div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatSettlementMoney(item.amount, item.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={statusBadgeClass(item.status)}>{item.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-base font-semibold">تسویه کانال اخیر</h2>
          {!d.recent.channelSettlements.length ? (
            <EmptyState title="تسویه کانالی نیست" description="هنوز صورتحساب کانال ثبت نشده." />
          ) : (
            <ul className="space-y-2 rounded-lg border p-3 text-sm">
              {d.recent.channelSettlements.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <Link
                    href={settlementChannelPath(c.id)}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {c.number} · {c.channelCode}
                  </Link>
                  <span className="tabular-nums text-muted-foreground">
                    {formatSettlementMoney(c.expectedNet, c.currency)}
                  </span>
                  <Badge className={statusBadgeClass(c.status)}>
                    {channelSettlementStatusLabel(c.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="text-base font-semibold">مغایرت‌گیری اخیر</h2>
          {!d.recent.reconciliations.length ? (
            <EmptyState title="پرونده مغایرت نیست" description="هنوز پرونده تطبیق باز نشده." />
          ) : (
            <ul className="space-y-2 rounded-lg border p-3 text-sm">
              {d.recent.reconciliations.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <Link
                    href={settlementReconciliationPath(r.id)}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    {r.number}
                  </Link>
                  <span className="text-muted-foreground">{r.sourceType}</span>
                  <Badge className={statusBadgeClass(r.status)}>
                    {reconciliationStatusLabel(r.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
