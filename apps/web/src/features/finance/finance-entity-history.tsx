'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  financeAuditActionLabel,
} from '@/features/finance/finance-audit-labels';
import { fetchFinanceAuditLogs } from '@/lib/api/hector';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAuditKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { financeAuditEntityPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export type FinanceEntityHistoryProps = {
  entityType: string;
  entityId: string;
  pageSize?: number;
};

/**
 * Lightweight Finance entity history. Prefers finance.audit.read; falls back to audit.read UX note.
 */
export function FinanceEntityHistory({
  entityType,
  entityId,
  pageSize = 10,
}: FinanceEntityHistoryProps) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const [page, setPage] = React.useState(1);
  const canFinanceAudit = can(PERMISSIONS.FINANCE_AUDIT_READ);

  const query = useQuery({
    queryKey: financeAuditKeys.list(companyId, { entityType, entityId, page, pageSize }),
    enabled: Boolean(companyId) && canFinanceAudit,
    queryFn: () =>
      fetchFinanceAuditLogs(companyId, {
        page,
        pageSize,
        entityType,
        entityId,
      }),
  });

  if (!canFinanceAudit) {
    return (
      <p className="text-sm text-slate-500">
        برای مشاهده تاریخچه مالی به مجوز «حسابرسی مالی» نیاز دارید.
      </p>
    );
  }

  if (query.isLoading) return <TableSkeleton rows={4} />;
  if (query.isError) {
    return (
      <ErrorState
        title="خطا در دریافت تاریخچه"
        message="بارگذاری تاریخچه مالی انجام نشد."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  if (rows.length === 0) {
    return <EmptyState title="هنوز رویداد مالی برای این موجودیت ثبت نشده است." />;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-slate-800">تاریخچه مالی</h3>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((item) => (
          <li key={item.id} className="px-4 py-3 text-sm">
            <div className="font-medium text-slate-900">{financeAuditActionLabel(item.action)}</div>
            <div className="mt-0.5 text-slate-600">
              {item.actor.displayName ?? item.actor.email ?? 'سیستم'} ·{' '}
              {formatDateTime(item.createdAt)}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={financeAuditEntityPath(entityType, entityId)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          مشاهده در حسابرسی مالی
        </Link>
        {totalPages > 1 ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              قبلی
            </Button>
            <span className="self-center text-xs text-slate-500">
              {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              بعدی
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
