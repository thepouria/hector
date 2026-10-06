'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AccessDenied, EmptyState, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  FINANCE_AUDIT_ENTITY_TYPE_OPTIONS,
  financeAuditActionLabel,
  financeAuditEntityTypeLabel,
} from '@/features/finance/finance-audit-labels';
import { fetchFinanceAuditLog, fetchFinanceAuditLogs } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatDateTime, redactSensitive } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAuditKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';
import type { AuditDetail, AuditListItem } from '@/types/api';

export function FinanceAuditPageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const page = Number(searchParams.get('page') ?? '1') || 1;
  const action = searchParams.get('action') ?? '';
  const entityType = searchParams.get('entityType') ?? '';
  const entityId = searchParams.get('entityId') ?? '';
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_AUDIT_READ);

  const listQuery = useQuery({
    queryKey: financeAuditKeys.list(companyId, { page, action, entityType, entityId }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () =>
      fetchFinanceAuditLogs(companyId, {
        page,
        pageSize: 20,
        action: action || undefined,
        entityType: entityType || undefined,
        entityId: entityId || undefined,
      }),
  });

  const detailQuery = useQuery({
    queryKey: financeAuditKeys.detail(companyId, selectedId ?? ''),
    enabled: Boolean(companyId && selectedId),
    queryFn: () => fetchFinanceAuditLog(companyId, selectedId!),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  if (!canRead) {
    return <AccessDenied />;
  }

  function updateFilters(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }
    if (!next.page) params.set('page', '1');
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div dir="rtl">
      <PageHeader
        title="حسابرسی مالی"
        description="رویدادهای ممیزی دامنه مالی — فقط خواندنی"
        breadcrumbs={[
          { label: 'مالی', href: '/app/finance' },
          { label: 'حسابرسی مالی' },
        ]}
      />

      <form
        className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          updateFilters({
            action: String(form.get('action') ?? ''),
            entityType: String(form.get('entityType') ?? ''),
            entityId: String(form.get('entityId') ?? ''),
            page: '1',
          });
        }}
      >
        <div>
          <Label htmlFor="action">عملیات</Label>
          <Input id="action" name="action" defaultValue={action} dir="ltr" className="text-start" />
        </div>
        <div>
          <Label htmlFor="entityType">نوع موجودیت</Label>
          <select
            id="entityType"
            name="entityType"
            defaultValue={entityType}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">همهٔ موجودیت‌های مالی</option>
            {FINANCE_AUDIT_ENTITY_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {financeAuditEntityTypeLabel(type)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="entityId">شناسه موجودیت</Label>
          <Input
            id="entityId"
            name="entityId"
            defaultValue={entityId}
            dir="ltr"
            className="text-start"
          />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">اعمال فیلتر</Button>
          <Button type="button" variant="outline" onClick={() => router.replace(pathname)}>
            پاک کردن
          </Button>
        </div>
      </form>

      {listQuery.isLoading ? <TableSkeleton /> : null}
      {listQuery.error ? (
        isApiClientError(listQuery.error) && listQuery.error.status === 403 ? (
          <AccessDenied />
        ) : (
          <ErrorState
            message={isApiClientError(listQuery.error) ? listQuery.error.message : undefined}
            requestId={isApiClientError(listQuery.error) ? listQuery.error.requestId : undefined}
            onRetry={() => void listQuery.refetch()}
          />
        )
      ) : null}

      {listQuery.data && listQuery.data.data.length === 0 ? (
        <EmptyState title="هیچ رویداد حسابرسی مالی با این فیلتر پیدا نشد." />
      ) : null}

      {listQuery.data && listQuery.data.data.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">زمان</th>
                  <th className="px-3 py-2 text-start font-medium">کاربر</th>
                  <th className="px-3 py-2 text-start font-medium">عملیات</th>
                  <th className="px-3 py-2 text-start font-medium">موجودیت</th>
                  <th className="px-3 py-2 text-start font-medium">شناسه</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.data.data.map((row: AuditListItem) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    onClick={() => setSelectedId(row.id)}
                  >
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.createdAt)}</td>
                    <td className="px-3 py-2">
                      {row.actor.displayName ?? row.actor.email ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <Badge>{financeAuditActionLabel(row.action)}</Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {financeAuditEntityTypeLabel(row.entityType)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {row.entityId ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>
              صفحه {listQuery.data.meta.page} از {listQuery.data.meta.totalPages} (
              {listQuery.data.meta.total} رکورد)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateFilters({ page: String(page - 1) })}
              >
                قبلی
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= listQuery.data.meta.totalPages}
                onClick={() => updateFilters({ page: String(page + 1) })}
              >
                بعدی
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        title="جزئیات رویداد"
        description="جزئیات حسابرسی مالی"
        className="max-w-2xl"
      >
        {detailQuery.isLoading ? <TableSkeleton rows={3} /> : null}
        {detailQuery.data ? <AuditDetailBody detail={detailQuery.data} /> : null}
        {detailQuery.error ? (
          <ErrorState
            message={isApiClientError(detailQuery.error) ? detailQuery.error.message : undefined}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function AuditDetailBody({ detail }: { detail: AuditDetail }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="text-slate-500">عملیات:</span> {financeAuditActionLabel(detail.action)}
      </p>
      <p>
        <span className="text-slate-500">موجودیت:</span>{' '}
        {financeAuditEntityTypeLabel(detail.entityType)}
      </p>
      <p dir="ltr" className="text-start font-mono text-xs">
        {detail.entityId}
      </p>
      <p>{formatDateTime(detail.createdAt)}</p>
      {detail.metadata ? (
        <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs" dir="ltr">
          {JSON.stringify(redactSensitive(detail.metadata), null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
