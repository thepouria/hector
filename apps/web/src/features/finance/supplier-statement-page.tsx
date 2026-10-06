'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { fetchSupplierStatement } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financePayableKeys } from '@/lib/query/keys';
import { financePayablePath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SupplierStatementPageClient({ supplierId }: { supplierId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_PAYABLES_READ);

  const query = useQuery({
    queryKey: financePayableKeys.statement(companyId, supplierId),
    queryFn: () => fetchSupplierStatement(companyId, supplierId),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (query.isLoading) return <TableSkeleton rows={8} />;
  if (query.isError) {
    if (isApiClientError(query.error) && query.error.status === 401) handleUnauthorized();
    return (
      <ErrorState message="صورت‌حساب تأمین‌کننده بارگذاری نشد." onRetry={() => query.refetch()} />
    );
  }

  const entries = query.data?.entries ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="صورت‌حساب تأمین‌کننده"
        description="دفتر بدهی تأمین‌کننده — افزایش/کاهش و اعتبار. ارزها مخلوط نمی‌شوند."
        actions={
          <Link
            href={ROUTES.financePayables}
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            حساب‌های پرداختنی
          </Link>
        }
      />

      {!entries.length ? (
        <EmptyState title="حرکتی نیست" description="هنوز بدهی یا اعتباری برای این تأمین‌کننده نیست." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-2 py-2 font-medium">تاریخ</th>
                <th className="px-2 py-2 font-medium">نوع</th>
                <th className="px-2 py-2 font-medium">بدهی</th>
                <th className="px-2 py-2 font-medium">مبلغ</th>
                <th className="px-2 py-2 font-medium">یادداشت</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.effectiveAt}-${entry.type}-${index}`} className="border-b">
                  <td className="px-2 py-2 whitespace-nowrap">
                    {new Date(entry.effectiveAt).toLocaleString('fa-IR')}
                  </td>
                  <td className="px-2 py-2">
                    {entry.kind} / {entry.type}
                  </td>
                  <td className="px-2 py-2">
                    {entry.payableId && entry.payableNumber ? (
                      <Link
                        href={financePayablePath(entry.payableId)}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {entry.payableNumber}
                      </Link>
                    ) : (
                      entry.creditNumber ?? '—'
                    )}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {entry.direction === 'DECREASE' ? '−' : entry.direction === 'INCREASE' ? '+' : ''}
                    {entry.amount} {entry.currency}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{entry.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
