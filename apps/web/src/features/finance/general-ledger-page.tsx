'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchGeneralLedger, fetchLedgerAccounts } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeJournalKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function GeneralLedgerPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_JOURNALS_READ);

  const [ledgerAccountId, setLedgerAccountId] = React.useState('');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');

  const accountsQuery = useQuery({
    queryKey: financeJournalKeys.ledgerAccounts(companyId),
    queryFn: () => fetchLedgerAccounts(companyId, { pageSize: 100 }),
    enabled: Boolean(companyId) && canRead,
  });

  const filters = {
    ledgerAccountId,
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    page: 1,
    pageSize: 50,
  };

  const glQuery = useQuery({
    queryKey: financeJournalKeys.generalLedger(companyId, filters),
    queryFn: () => fetchGeneralLedger(companyId, filters),
    enabled: Boolean(companyId) && canRead && Boolean(ledgerAccountId),
  });

  if (!canRead) return <AccessDenied />;
  if (accountsQuery.isError) {
    if (isApiClientError(accountsQuery.error) && accountsQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState
        message="بارگذاری حساب‌های دفتر ناموفق بود."
        onRetry={() => accountsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="دفتر کل"
        description="ردیف‌های ثبت‌شده یک حساب دفتر با مانده تجمعی در ارز پایه شرکت."
      />

      <div className="grid max-w-3xl gap-3 sm:grid-cols-3">
        <label className="block space-y-1 text-sm sm:col-span-3">
          <Label>حساب دفتر</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={ledgerAccountId}
            onChange={(e) => setLedgerAccountId(e.target.value)}
          >
            <option value="">انتخاب حساب…</option>
            {(accountsQuery.data?.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <Label>از تاریخ</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            dir="ltr"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <Label>تا تاریخ</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            dir="ltr"
          />
        </label>
      </div>

      {!ledgerAccountId ? (
        <EmptyState
          title="حساب را انتخاب کنید"
          description="برای مشاهده دفتر کل، یک حساب دفتر لازم است."
        />
      ) : glQuery.isLoading ? (
        <TableSkeleton rows={8} />
      ) : glQuery.isError ? (
        (() => {
          if (isApiClientError(glQuery.error) && glQuery.error.status === 401) {
            handleUnauthorized();
          }
          return (
            <ErrorState
              message="بارگذاری دفتر کل ناموفق بود."
              onRetry={() => glQuery.refetch()}
            />
          );
        })()
      ) : !glQuery.data?.data.length ? (
        <EmptyState
          title="ردیفی نیست"
          description={`مانده ابتدای دوره: ${glQuery.data?.openingBalanceBase ?? '0'} ${
            glQuery.data?.baseCurrency ?? ''
          }`}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {glQuery.data.ledgerAccount.code} — {glQuery.data.ledgerAccount.name} · ارز پایه{' '}
            {glQuery.data.baseCurrency} · افتتاحیه {glQuery.data.openingBalanceBase} · اختتامیه{' '}
            {glQuery.data.closingBalanceBase}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b text-right text-muted-foreground">
                  <th className="px-2 py-2">تاریخ</th>
                  <th className="px-2 py-2">سند</th>
                  <th className="px-2 py-2">شرح</th>
                  <th className="px-2 py-2">جهت</th>
                  <th className="px-2 py-2">مبلغ پایه</th>
                  <th className="px-2 py-2">مانده</th>
                </tr>
              </thead>
              <tbody>
                {glQuery.data.data.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="px-2 py-2 whitespace-nowrap">
                      {new Date(row.effectiveAt).toLocaleDateString('fa-IR')}
                    </td>
                    <td className="px-2 py-2 font-mono">{row.journalNumber}</td>
                    <td className="px-2 py-2">{row.description}</td>
                    <td className="px-2 py-2">{row.direction === 'DEBIT' ? 'بدهکار' : 'بستانکار'}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.baseAmount}</td>
                    <td className="px-2 py-2 font-mono tabular-nums">{row.runningBalanceBase}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
