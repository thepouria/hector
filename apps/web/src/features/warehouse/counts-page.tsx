'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  actorDisplayName,
  stockCountStatusLabel,
  stockCountTypeLabel,
} from '@/features/warehouse/stock-count-labels';
import { fetchStockCounts } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, warehouseCountPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { StockCountStatus, StockCountType } from '@/types/stock-count';

export function CountsPageClient() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.WAREHOUSE_COUNT_CREATE);

  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<StockCountStatus | ''>('');
  const [type, setType] = React.useState<StockCountType | ''>('');
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const listFilters = {
    page,
    pageSize: 20,
    status: status || undefined,
    type: type || undefined,
    q: search || undefined,
  };

  const listQuery = useQuery({
    queryKey: warehouseKeys.counts.list(companyId, listFilters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_COUNT_READ),
    queryFn: () => fetchStockCounts(companyId, listFilters),
  });

  if (!can(PERMISSIONS.WAREHOUSE_COUNT_READ)) return <AccessDenied />;

  const listRows = listQuery.data?.data ?? [];
  const meta = listQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="شمارش موجودی"
        description="شمارش فیزیکی با اسکن — اختلاف‌ها پس از تأیید به موجودی اعمال می‌شوند."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'شمارش موجودی' },
        ]}
        actions={
          canCreate ? (
            <Link href={ROUTES.warehouseCountNew} className={cn(buttonVariants())}>
              شمارش جدید
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="count-search">جستجو</Label>
          <Input
            id="count-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="شماره COUNT یا کد انبار"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="count-status">وضعیت</Label>
          <select
            id="count-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StockCountStatus | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="IN_PROGRESS">در حال شمارش</option>
            <option value="SUBMITTED">ارسال‌شده</option>
            <option value="RECOUNT_REQUIRED">شمارش مجدد</option>
            <option value="APPROVED">تأیید شده</option>
            <option value="POSTED">ثبت‌شده</option>
            <option value="REJECTED">رد شده</option>
            <option value="CANCELLED">لغو شده</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="count-type">نوع</Label>
          <select
            id="count-type"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={type}
            onChange={(e) => {
              setType(e.target.value as StockCountType | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="FULL">کامل</option>
            <option value="CYCLE">چرخه‌ای</option>
          </select>
        </div>
      </div>

      {listQuery.isPending ? (
        <TableSkeleton />
      ) : listQuery.isError ? (
        <ErrorState
          message={mapBusinessError(listQuery.error)}
          onRetry={() => listQuery.refetch()}
        />
      ) : listRows.length === 0 ? (
        <EmptyState title="شمارشی ثبت نشده است." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">شماره</th>
                <th className="px-3 py-2 text-start font-medium">نوع</th>
                <th className="px-3 py-2 text-start font-medium">انبار</th>
                <th className="px-3 py-2 text-start font-medium">محدوده</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">ردیف‌ها</th>
                <th className="px-3 py-2 text-start font-medium">شمارش‌شده</th>
                <th className="px-3 py-2 text-start font-medium">اختلاف</th>
                <th className="px-3 py-2 text-start font-medium">شروع</th>
                <th className="px-3 py-2 text-start font-medium">ارسال</th>
                <th className="px-3 py-2 text-start font-medium">ثبت</th>
                <th className="px-3 py-2 text-start font-medium">ایجادکننده</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(warehouseCountPath(row.id))}
                >
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {row.number}
                  </td>
                  <td className="px-3 py-2">{stockCountTypeLabel(row.type)}</td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {row.warehouse.code}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">{row.scopeSummary}</td>
                  <td className="px-3 py-2">
                    <Badge>{stockCountStatusLabel(row.status)}</Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.lineCount}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.countedLineCount}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.differenceLineCount}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {row.startedAt ? formatDateTime(row.startedAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {row.submittedAt ? formatDateTime(row.submittedAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {row.postedAt ? formatDateTime(row.postedAt) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{actorDisplayName(row.createdBy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {meta && totalPages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            قبلی
          </Button>
          <div className="text-sm text-slate-600" dir="ltr">
            {page} / {totalPages}
          </div>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            بعدی
          </Button>
        </div>
      ) : null}
    </div>
  );
}
