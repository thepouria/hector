'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  fetchWarehouseEntityActivity,
  type WarehouseActivityItem,
} from '@/lib/api/hector';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { auditEntityPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

type EntityKind =
  | 'GOODS_RECEIPT'
  | 'STOCK_TRANSFER'
  | 'INVENTORY_ADJUSTMENT'
  | 'STOCK_COUNT'
  | 'STOCK_ISSUE'
  | 'SUPPLIER_RETURN_EXECUTION';

function activityPath(kind: EntityKind, entityId: string): Parameters<
  typeof fetchWarehouseEntityActivity
>[1] {
  switch (kind) {
    case 'GOODS_RECEIPT':
      return `/api/v1/goods-receipts/${entityId}/activity`;
    case 'STOCK_TRANSFER':
      return `/api/v1/warehouse/transfers/${entityId}/activity`;
    case 'INVENTORY_ADJUSTMENT':
      return `/api/v1/warehouse/adjustments/${entityId}/activity`;
    case 'STOCK_COUNT':
      return `/api/v1/warehouse/counts/${entityId}/activity`;
    case 'STOCK_ISSUE':
      return `/api/v1/warehouse/issues/${entityId}/activity`;
    case 'SUPPLIER_RETURN_EXECUTION':
      return `/api/v1/warehouse/supplier-return-executions/${entityId}/activity`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function ActivityRow({ item }: { item: WarehouseActivityItem }) {
  return (
    <li className="px-4 py-3 text-sm">
      <div className="font-medium text-slate-900">{item.summary}</div>
      <div className="mt-0.5 text-slate-600">{formatDateTime(item.createdAt)}</div>
      {item.reason ? (
        <div className="mt-1 text-xs text-slate-600">دلیل: {item.reason}</div>
      ) : null}
      {item.changes.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
          {item.changes.slice(0, 6).map((change) => (
            <li key={`${item.id}-${change.field}`}>
              <span className="font-medium text-slate-700">{change.field}:</span>{' '}
              <span dir="ltr">
                {change.before ?? '—'} → {change.after ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Business activity timeline (domain-read permission). Projects Audit; not InventoryMovement. */
export function WarehouseEntityActivity({
  kind,
  entityId,
  readPermission,
}: {
  kind: EntityKind;
  entityId: string;
  readPermission: string;
}) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const [page, setPage] = React.useState(1);
  const canRead = can(readPermission);
  const canAudit = can(PERMISSIONS.AUDIT_READ);

  const query = useQuery({
    queryKey: warehouseKeys.activity(companyId, kind, entityId, page),
    enabled: Boolean(companyId) && canRead,
    staleTime: 15_000,
    queryFn: () =>
      fetchWarehouseEntityActivity(companyId, activityPath(kind, entityId), {
        page,
        pageSize: 12,
      }),
  });

  if (!canRead) {
    return (
      <p className="text-sm text-slate-500">برای مشاهده فعالیت‌ها مجوز کافی ندارید.</p>
    );
  }
  if (query.isLoading) return <TableSkeleton rows={4} />;
  if (query.isError) {
    return (
      <ErrorState
        title="خطا در دریافت فعالیت‌ها"
        message="بارگذاری فعالیت‌های انبار انجام نشد."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rows = query.data?.data ?? [];
  const totalPages = query.data?.meta.totalPages ?? 1;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">فعالیت‌ها</h2>
        {canAudit ? (
          <Link
            href={auditEntityPath(kind, entityId)}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            ممیزی فنی
          </Link>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="هنوز فعالیتی ثبت نشده است." />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {rows.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </ul>
      )}
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
    </section>
  );
}
