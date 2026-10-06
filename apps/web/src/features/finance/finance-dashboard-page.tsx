'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  HorizontalBarList,
  SimpleTrendBars,
} from '@/features/purchasing/dashboard-charts';
import { financeAuditActionLabel } from '@/features/finance/finance-audit-labels';
import { fetchFinanceDashboard, type FinanceDashboard } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeDashboardKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  financeExpensePath,
  financeExpensesUnpaidPath,
  financeLoanPath,
  financePayablePath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const RANGE_OPTIONS = [
  { value: 'today', label: 'امروز' },
  { value: '7d', label: '۷ روز اخیر' },
  { value: '30d', label: '۳۰ روز اخیر' },
  { value: 'this_month', label: 'این ماه' },
  { value: 'custom', label: 'بازه دلخواه' },
] as const;

const HUBS = [
  {
    href: ROUTES.financeAccounts,
    title: 'حساب‌ها',
    description: 'حساب‌های نقد و بانک — موجودی از دفتر حرکات مشتق می‌شود.',
  },
  {
    href: ROUTES.financeMoneyMovements,
    title: 'حرکت پول',
    description: 'پرداخت، دریافت و انتقال بین حساب‌ها.',
  },
  {
    href: ROUTES.financeLiabilities,
    title: 'بدهی‌ها',
    description: 'حساب‌های پرداختنی تأمین‌کننده، وام، هزینه‌های پرداخت‌نشده و تسویه.',
  },
  {
    href: ROUTES.financeExpenses,
    title: 'هزینه‌ها',
    description: 'شناخت هزینه اقتصادی — جدا از پرداخت نقدی.',
  },
  {
    href: ROUTES.financeCapital,
    title: 'سرمایه و تأمین مالی',
    description: 'آورده سرمایه (حقوق مالکانه). وام بدهی است و در بخش بدهی‌هاست — نه سرمایه.',
  },
  {
    href: ROUTES.financeFx,
    title: 'ارز / FX',
    description: 'نرخ‌ها، تبدیل ارز و موقعیت ارزی.',
  },
  {
    href: ROUTES.financeAccounting,
    title: 'حسابداری',
    description: 'اسناد روزنامه، دفتر کل، تراز آزمایشی و حساب‌های دفتر.',
  },
] as const;

function formatMoney(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}

function parseDisplay(amount: string): number {
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
}

function dueHref(item: { type: string; id: string }): string {
  if (item.type === 'SUPPLIER_PAYABLE') return financePayablePath(item.id);
  if (item.type === 'LOAN') return financeLoanPath(item.id);
  if (item.type === 'EXPENSE') return financeExpensePath(item.id);
  return ROUTES.financeLiabilities;
}

function dueTypeLabel(type: string): string {
  if (type === 'SUPPLIER_PAYABLE') return 'بدهی تأمین‌کننده';
  if (type === 'LOAN') return 'وام';
  if (type === 'EXPENSE') return 'هزینه';
  return type;
}

export function FinanceDashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_DASHBOARD_READ);

  const range = searchParams.get('range') ?? '30d';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const chartCurrency = searchParams.get('chartCurrency') ?? '';

  const filters = {
    range: range || '30d',
    ...(range === 'custom' && from ? { from } : {}),
    ...(range === 'custom' && to ? { to } : {}),
    ...(chartCurrency ? { chartCurrency } : {}),
  };

  const replaceFilters = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    if (patch.range && patch.range !== 'custom') {
      params.delete('from');
      params.delete('to');
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`);
  };

  const dashboardQuery = useQuery({
    queryKey: financeDashboardKeys.detail(companyId, filters),
    enabled: Boolean(companyId) && canRead,
    staleTime: 30_000,
    queryFn: () => fetchFinanceDashboard(companyId, filters),
  });

  React.useEffect(() => {
    if (
      dashboardQuery.error &&
      isApiClientError(dashboardQuery.error) &&
      dashboardQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [dashboardQuery.error, handleUnauthorized]);

  if (!canRead) return <AccessDenied />;
  if (dashboardQuery.isPending) return <PageSkeleton />;
  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <ErrorState
        message={
          mapBusinessError(dashboardQuery.error) ||
          'دریافت داشبورد مالی با مشکل مواجه شد.'
        }
        onRetry={() => dashboardQuery.refetch()}
      />
    );
  }

  const data = dashboardQuery.data;
  return (
    <div className="space-y-8" dir="rtl">
      <PageHeader
        title="داشبورد مالی"
        description={
          activeCompany
            ? `نمای عملیاتی مالی «${activeCompany.name}» — ورود/خروج پول ≠ درآمد/هزینه/سود`
            : 'نمای عملیاتی مالی'
        }
        breadcrumbs={[{ label: 'مالی' }]}
        actions={
          can(PERMISSIONS.FINANCE_AUDIT_READ) ? (
            <Link href={ROUTES.financeAudit} className={cn(buttonVariants({ variant: 'outline' }))}>
              حسابرسی مالی
            </Link>
          ) : null
        }
      />

      <FiltersBar
        range={range}
        from={from}
        to={to}
        chartCurrency={chartCurrency || data.chartCurrency}
        availableCurrencies={availableCurrencies(data)}
        onChange={replaceFilters}
      />

      <p className="rounded-md border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-sm text-slate-700">
        ورود پول = دریافت نقدی (نه درآمد) · خروج پول = پرداخت نقدی (نه هزینه) · حرکت نقد ≠ سود.
        انتقال داخلی در ورود/خروج لحاظ نمی‌شود. ارزها هرگز با هم جمع نمی‌شوند.
      </p>

      <BalancesSection data={data} />
      <LiabilitiesSection data={data} />
      <CashMovementSection data={data} />
      <ExpensesSection data={data} />
      <DueListsSection data={data} />
      <RecentActivitySection data={data} />

      <section className="space-y-4">
        <h2 className="text-base font-medium">هاب‌های عملیاتی</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {HUBS.map((hub) => (
            <Link
              key={hub.href}
              href={hub.href}
              className="group block rounded-lg border border-border/80 bg-background p-4 transition-colors hover:border-foreground/20 hover:bg-muted/40"
            >
              <h3 className="text-base font-medium">{hub.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{hub.description}</p>
              <span className="mt-3 inline-block text-sm font-medium text-slate-900 underline-offset-2 group-hover:underline">
                ورود
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function availableCurrencies(data: FinanceDashboard): string[] {
  const set = new Set<string>();
  for (const row of data.snapshot.accountsByCurrency ?? []) set.add(row.currency);
  for (const row of data.periodMetrics.moneyInByCurrency ?? []) set.add(row.currency);
  for (const row of data.periodMetrics.moneyOutByCurrency ?? []) set.add(row.currency);
  if (data.chartCurrency) set.add(data.chartCurrency);
  return [...set].sort();
}

function FiltersBar({
  range,
  from,
  to,
  chartCurrency,
  availableCurrencies: currencies,
  onChange,
}: {
  range: string;
  from: string;
  to: string;
  chartCurrency: string;
  availableCurrencies: string[];
  onChange: (patch: Record<string, string | undefined>) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <label className="space-y-1 text-sm">
        <span>بازهٔ دوره</span>
        <select
          className="flex h-10 rounded-md border border-input bg-background px-3"
          value={range}
          onChange={(e) => onChange({ range: e.target.value })}
        >
          {RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {range === 'custom' ? (
        <>
          <div>
            <Label htmlFor="from">از</Label>
            <Input
              id="from"
              type="date"
              value={from.slice(0, 10)}
              onChange={(e) => onChange({ from: e.target.value || undefined, range: 'custom' })}
            />
          </div>
          <div>
            <Label htmlFor="to">تا</Label>
            <Input
              id="to"
              type="date"
              value={to.slice(0, 10)}
              onChange={(e) => onChange({ to: e.target.value || undefined, range: 'custom' })}
            />
          </div>
        </>
      ) : null}
      <label className="space-y-1 text-sm">
        <span>ارز نمودار</span>
        <select
          className="flex h-10 rounded-md border border-input bg-background px-3"
          value={chartCurrency}
          onChange={(e) => onChange({ chartCurrency: e.target.value || undefined })}
        >
          {currencies.length === 0 ? <option value={chartCurrency}>{chartCurrency}</option> : null}
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function BalancesSection({ data }: { data: FinanceDashboard }) {
  const rows = data.snapshot.accountsByCurrency;
  if (rows === undefined) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">موجودی حساب‌ها (به‌ازای ارز و نوع)</h2>
        <Link href={ROUTES.financeAccounts} className="text-sm underline-offset-2 hover:underline">
          حساب‌ها
        </Link>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="حساب فعالی با موجودی ثبت نشده است." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Link
              key={`${row.currency}-${row.type}`}
              href={ROUTES.financeAccounts}
              className="rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50"
            >
              <div className="text-sm text-slate-500">
                {row.type} · {row.currency}
              </div>
              <div className="mt-1 font-mono text-lg tabular-nums" dir="ltr">
                {formatMoney(row.balance, row.currency)}
              </div>
              <div className="mt-1 text-xs text-slate-500">{row.accountCount} حساب</div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function LiabilitiesSection({ data }: { data: FinanceDashboard }) {
  const payables = data.snapshot.supplierPayablesByCurrency;
  const loans = data.snapshot.loansByCurrency;
  const expenses = data.snapshot.expenseOutstandingByCurrency;
  const top = data.snapshot.topSuppliers;
  if (
    payables === undefined &&
    loans === undefined &&
    expenses === undefined &&
    top === undefined
  ) {
    return null;
  }

  return (
    <section className="space-y-4">
      <h2 className="text-base font-medium">بدهی‌ها و سررسید</h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {payables !== undefined ? (
          <CurrencyBucketCard
            title="بدهی تأمین‌کننده"
            href={ROUTES.financePayables}
            rows={payables}
            empty="بدهی باز نیست."
          />
        ) : null}
        {loans !== undefined ? (
          <CurrencyBucketCard
            title="وام‌های باز"
            href={ROUTES.financeLoans}
            rows={loans}
            empty="وام بازی نیست."
          />
        ) : null}
        {expenses !== undefined ? (
          <CurrencyBucketCard
            title="هزینه پرداخت‌نشده"
            href={financeExpensesUnpaidPath()}
            rows={expenses}
            empty="هزینه پرداخت‌نشده‌ای نیست."
          />
        ) : null}
      </div>
      {top !== undefined ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-medium">برترین تأمین‌کنندگان (به‌ازای هر ارز)</h3>
          <HorizontalBarList
            emptyLabel="تأمین‌کننده‌ای با بدهی باز نیست."
            rows={top.map((row) => {
              const peers = top.filter((t) => t.currency === row.currency);
              const max = Math.max(...peers.map((p) => parseDisplay(p.outstanding)), 1);
              return {
                id: `${row.currency}-${row.supplierId}`,
                label: `${row.supplierName} (${row.currency})`,
                valueLabel: formatMoney(row.outstanding, row.currency),
                ratio: parseDisplay(row.outstanding) / max,
                href: `${ROUTES.financePayables}?supplierId=${row.supplierId}`,
              };
            })}
          />
        </div>
      ) : null}
    </section>
  );
}

function CurrencyBucketCard({
  title,
  href,
  rows,
  empty,
}: {
  title: string;
  href: string;
  rows: Array<{ currency: string; amount: string }>;
  empty: string;
}) {
  return (
    <Link href={href} className="block rounded-lg border border-slate-200 bg-white p-4 hover:bg-slate-50">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {rows.map((row) => (
            <li key={row.currency} className="font-mono text-sm tabular-nums" dir="ltr">
              {formatMoney(row.amount, row.currency)}
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}

function CashMovementSection({ data }: { data: FinanceDashboard }) {
  const moneyIn = data.periodMetrics.moneyInByCurrency;
  const moneyOut = data.periodMetrics.moneyOutByCurrency;
  const trend = data.periodMetrics.cashMovementTrend;
  if (moneyIn === undefined && moneyOut === undefined && trend === undefined) return null;

  const trendPoints =
    trend?.map((point) => ({
      key: point.bucket,
      label: point.bucket.replace(/^W/, ''),
      value: parseDisplay(point.moneyIn) + parseDisplay(point.moneyOut),
      tip: `${point.bucket} · ورود ${point.moneyIn} · خروج ${point.moneyOut} ${data.chartCurrency}`,
    })) ?? [];

  return (
    <section className="space-y-4">
      <h2 className="text-base font-medium">ورود و خروج پول (دوره)</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {moneyIn !== undefined ? (
          <CurrencyBucketCard
            title="ورود پول (دریافت)"
            href={ROUTES.financeReceipts}
            rows={moneyIn}
            empty="دریافتی در این بازه نیست."
          />
        ) : null}
        {moneyOut !== undefined ? (
          <CurrencyBucketCard
            title="خروج پول (پرداخت)"
            href={ROUTES.financePayments}
            rows={moneyOut}
            empty="پرداختی در این بازه نیست."
          />
        ) : null}
      </div>
      {trend !== undefined ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-medium">
            روند ورود/خروج — {data.chartCurrency} (حرکت نقد ≠ سود)
          </h3>
          <SimpleTrendBars
            points={trendPoints}
            emptyLabel="در این بازه حرکت نقدی ثبت نشده است."
          />
          {trend.length > 0 ? (
            <ul className="mt-4 grid gap-1 text-xs text-slate-600 sm:grid-cols-2" dir="ltr">
              {trend.slice(-8).map((p) => (
                <li key={p.bucket}>
                  {p.bucket}: in {p.moneyIn} / out {p.moneyOut}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExpensesSection({ data }: { data: FinanceDashboard }) {
  const recorded = data.periodMetrics.expensesRecordedByCurrency;
  const byCategory = data.periodMetrics.expensesByCategory;
  if (recorded === undefined && byCategory === undefined) return null;

  const categoryRows = (byCategory ?? []).map((row) => {
    const peers = (byCategory ?? []).filter((c) => c.currency === row.currency);
    const max = Math.max(...peers.map((p) => parseDisplay(p.amount)), 1);
    return {
      id: `${row.currency}-${row.categoryId}`,
      label: `${row.categoryName} (${row.currency})`,
      valueLabel: formatMoney(row.amount, row.currency),
      ratio: parseDisplay(row.amount) / max,
      href: ROUTES.financeExpenses,
    };
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">هزینه‌های ثبت‌شده (دوره)</h2>
        <Link href={ROUTES.financeExpenses} className="text-sm underline-offset-2 hover:underline">
          هزینه‌ها
        </Link>
      </div>
      {recorded !== undefined ? (
        <CurrencyBucketCard
          title="جمع هزینه اقتصادی به‌ازای ارز"
          href={ROUTES.financeExpenses}
          rows={recorded}
          empty="هزینه‌ای در این بازه تأیید نشده است."
        />
      ) : null}
      {byCategory !== undefined ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="mb-3 text-sm font-medium">هزینه بر اساس دسته</h3>
          <HorizontalBarList rows={categoryRows} emptyLabel="دسته‌ای در این بازه نیست." />
        </div>
      ) : null}
    </section>
  );
}

function DueListsSection({ data }: { data: FinanceDashboard }) {
  const overdue = data.snapshot.overdue;
  const dueSoon = data.snapshot.dueSoon;
  if (overdue === undefined && dueSoon === undefined) return null;

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <DueList title="سررسید گذشته" items={overdue ?? []} empty="مورد سررسید گذشته‌ای نیست." />
      <DueList title="سررسید نزدیک (۷ روز)" items={dueSoon ?? []} empty="مورد سررسید نزدیکی نیست." />
    </section>
  );
}

function DueList({
  title,
  items,
  empty,
}: {
  title: string;
  items: NonNullable<FinanceDashboard['snapshot']['overdue']>;
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`} className="py-2">
              <Link href={dueHref(item)} className="block hover:underline">
                <div className="font-medium">
                  {dueTypeLabel(item.type)} · {item.number}
                </div>
                <div className="text-slate-600">{item.counterparty}</div>
                <div className="mt-0.5 flex justify-between gap-2 text-xs text-slate-500">
                  <span>{formatDateTime(item.dueDate)}</span>
                  <span className="font-mono tabular-nums" dir="ltr">
                    {formatMoney(item.outstanding, item.currency)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentActivitySection({ data }: { data: FinanceDashboard }) {
  const activity = data.recentActivity;
  if (activity === undefined) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-medium">فعالیت اخیر مالی</h2>
        <Link href={ROUTES.financeAudit} className="text-sm underline-offset-2 hover:underline">
          حسابرسی مالی
        </Link>
      </div>
      {activity.length === 0 ? (
        <EmptyState title="رویداد اخیری ثبت نشده است." />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {activity.map((row, index) => (
            <li key={`${row.occurredAt}-${row.entityId ?? index}`} className="px-4 py-3 text-sm">
              <div className="font-medium">{financeAuditActionLabel(row.action)}</div>
              <div className="mt-0.5 text-slate-600">
                {row.actorName ?? 'سیستم'} · {formatDateTime(row.occurredAt)}
                {row.reference ? ` · ${row.reference}` : ''}
              </div>
              {row.amount && row.currency ? (
                <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-500" dir="ltr">
                  {formatMoney(row.amount, row.currency)}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
