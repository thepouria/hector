'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { fetchAuditLogs } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { auditKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const ENTITY_FILTERS = ['CHANNEL_SETTLEMENT', 'RECONCILIATION', 'SETTLEMENT'] as const;

export function SettlementAuditPage() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.AUDIT_READ);

  const [entityType, setEntityType] = React.useState<string>('RECONCILIATION');

  const listQuery = useQuery({
    queryKey: auditKeys.list(companyId, { entityType, pageSize: 50 }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () =>
      fetchAuditLogs(companyId, {
        entityType,
        page: 1,
        pageSize: 50,
      }),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  if (!canRead) return <AccessDenied />;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="تاریخچه تسویه / مغایرت‌گیری"
        description="رویدادهای حسابرسی مربوط به Settlement و Reconciliation — بدون JSON خام به‌عنوان UI اصلی."
        actions={
          <Link
            href={ROUTES.audit}
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            تاریخچه کامل
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        {ENTITY_FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-md border px-3 py-1.5 text-sm ${
              entityType === t ? 'border-primary bg-primary/5' : ''
            }`}
            onClick={() => setEntityType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : listQuery.isError ? (
        <ErrorState message="بارگذاری تاریخچه ناموفق بود." onRetry={() => listQuery.refetch()} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState title="رویدادی نیست" description="برای این نوع موجودیت هنوز حسابرسی ثبت نشده." />
      ) : (
        <ol className="space-y-3 border-r pr-4">
          {listQuery.data.data.map((item) => (
            <li key={item.id} className="relative text-sm">
              <div className="absolute -right-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
              <div className="font-medium">{item.action}</div>
              <div className="text-muted-foreground">
                {formatDateTime(item.createdAt)}
                {item.actor?.displayName || item.actor?.email
                  ? ` · ${item.actor.displayName ?? item.actor.email}`
                  : ''}
              </div>
              <div className="text-xs text-muted-foreground">
                {item.entityType} · {item.entityId?.slice(0, 8) ?? '—'}…
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
