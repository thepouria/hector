'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  formatSettlementMoney,
  reconciliationStatusLabel,
  statusBadgeClass,
} from '@/features/settlement/settlement-labels';
import { fetchReconciliations } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import { settlementReconciliationPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function ReconciliationListPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_RECONCILIATION_READ);

  const status = searchParams.get('status') ?? '';
  const needsMatching = searchParams.get('needsMatching') ?? '';
  const needsReview = searchParams.get('needsReview') ?? '';

  const filters: Record<string, string | number> = {
    page: 1,
    pageSize: 50,
  };
  if (status) filters.status = status;
  if (needsReview === 'true' || needsReview === '1') filters.needsReview = 'true';

  const listQuery = useQuery({
    queryKey: settlementKeys.reconciliations(companyId, { ...filters, needsMatching }),
    enabled: Boolean(companyId) && canRead,
    queryFn: async () => {
      if (needsMatching === '1' || needsMatching === 'true') {
        const [open, partial] = await Promise.all([
          fetchReconciliations(companyId, { ...filters, status: 'OPEN' }),
          fetchReconciliations(companyId, { ...filters, status: 'PARTIALLY_MATCHED' }),
        ]);
        return {
          data: [...open.data, ...partial.data],
          meta: { page: 1, pageSize: 50, total: open.data.length + partial.data.length },
        };
      }
      return fetchReconciliations(companyId, filters);
    },
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  if (!canRead) {
    return (
      <AccessDenied message="مشاهده مغایرت‌گیری نیازمند finance.reconciliation.read است." />
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="مرکز مغایرت‌گیری"
        description="مقایسه Expected در برابر Actual بدون تغییر هیچ‌کدام. اختلاف فقط پس از بستن تطبیق معنا دارد."
      />

      <div className="flex flex-wrap gap-4">
        <div>
          <Label htmlFor="status">وضعیت</Label>
          <select
            id="status"
            className="mt-1 block rounded-md border px-3 py-2 text-sm"
            value={status}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams.toString());
              params.delete('needsMatching');
              if (!e.target.value) params.delete('status');
              else params.set('status', e.target.value);
              router.replace(`${pathname}?${params.toString()}`);
            }}
          >
            <option value="">همه</option>
            <option value="OPEN">باز</option>
            <option value="PARTIALLY_MATCHED">تطبیق جزئی</option>
            <option value="MATCHED">تطبیق کامل</option>
            <option value="DISCREPANCY">مغایرت</option>
            <option value="UNDER_REVIEW">در حال بررسی</option>
            <option value="RESOLVED">حل‌شده</option>
          </select>
        </div>
      </div>

      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : listQuery.isError ? (
        <ErrorState message="بارگذاری پرونده‌ها ناموفق بود." onRetry={() => listQuery.refetch()} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState
          title="پرونده مغایرت نیست"
          description="از جزئیات تسویه کانال یا بدهی می‌توانید پرونده باز کنید."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1000px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-3 py-2 font-medium">شماره</th>
                <th className="px-3 py-2 font-medium">منبع</th>
                <th className="px-3 py-2 font-medium">Expected</th>
                <th className="px-3 py-2 font-medium">Matched</th>
                <th className="px-3 py-2 font-medium">مانده</th>
                <th className="px-3 py-2 font-medium">اختلاف</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
                <th className="px-3 py-2 font-medium">به‌روز</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => {
                const showDiff =
                  Boolean(row.matchingClosedAt) ||
                  row.status === 'DISCREPANCY' ||
                  row.status === 'UNDER_REVIEW' ||
                  row.status === 'RESOLVED' ||
                  row.status === 'MATCHED';
                return (
                  <tr key={row.id} className="border-b">
                    <td className="px-3 py-3">
                      <Link
                        href={settlementReconciliationPath(row.id)}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {row.number}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      {row.sourceType}
                      <div className="text-xs text-muted-foreground">{row.sourceId.slice(0, 8)}…</div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {formatSettlementMoney(row.expectedAmount, row.currency)}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {formatSettlementMoney(row.matchedAmount, row.currency)}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {formatSettlementMoney(row.remainingExpected, row.currency)}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {showDiff
                        ? formatSettlementMoney(row.differenceAmount, row.currency)
                        : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={statusBadgeClass(row.status)}>
                        {reconciliationStatusLabel(row.status)}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {formatDateTime(row.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
