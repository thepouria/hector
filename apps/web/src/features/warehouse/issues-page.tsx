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
  stockIssueReasonLabel,
  stockIssueStatusLabel,
} from '@/features/warehouse/stock-issue-labels';
import { fetchStockIssues } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, warehouseIssuePath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { StockIssueReason, StockIssueStatus } from '@/types/stock-issue';

export function IssuesPageClient() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.WAREHOUSE_ISSUE_CREATE);

  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState<StockIssueStatus | ''>('');
  const [reason, setReason] = React.useState<StockIssueReason | ''>('');
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
    reason: reason || undefined,
    q: search || undefined,
  };

  const listQuery = useQuery({
    queryKey: warehouseKeys.issues.list(companyId, listFilters),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_ISSUE_READ),
    queryFn: () => fetchStockIssues(companyId, listFilters),
  });

  if (!can(PERMISSIONS.WAREHOUSE_ISSUE_READ)) return <AccessDenied />;

  const listRows = listQuery.data?.data ?? [];
  const meta = listQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title="خروج غیرفروشی"
        description="خروج موجودی از شرکت بدون سفارش فروش — فقط از طریق دفتر حرکات."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'خروج غیرفروشی' },
        ]}
        actions={
          canCreate ? (
            <Link href={ROUTES.warehouseIssueNew} className={cn(buttonVariants())}>
              خروج جدید
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="issue-search">جستجو</Label>
          <Input
            id="issue-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="شماره ISS یا کد انبار"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="issue-status">وضعیت</Label>
          <select
            id="issue-status"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StockIssueStatus | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="POSTED">ثبت‌شده</option>
            <option value="CANCELLED">لغو شده</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="issue-reason">دلیل</Label>
          <select
            id="issue-reason"
            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as StockIssueReason | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="SAMPLE">نمونه</option>
            <option value="COMPANY_USE">مصرف داخلی</option>
            <option value="DAMAGE">امحا</option>
            <option value="MANUAL">دستی</option>
            <option value="OTHER">سایر</option>
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
        <EmptyState title="خروجی ثبت نشده است." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">شماره</th>
                <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                <th className="px-3 py-2 text-start font-medium">دلیل</th>
                <th className="px-3 py-2 text-start font-medium">انبار</th>
                <th className="px-3 py-2 text-start font-medium">اقلام</th>
                <th className="px-3 py-2 text-start font-medium">مجموع واحد</th>
                <th className="px-3 py-2 text-start font-medium">ایجاد</th>
                <th className="px-3 py-2 text-start font-medium">ثبت</th>
                <th className="px-3 py-2 text-start font-medium">ایجادکننده</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  onClick={() => router.push(warehouseIssuePath(row.id))}
                >
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {row.number}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{stockIssueStatusLabel(row.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">{stockIssueReasonLabel(row.reason)}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs" dir="ltr">
                      {row.warehouse.code}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.itemCount}
                  </td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {row.totalQuantity}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {formatDateTime(row.createdAt)}
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
