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
import { fetchAuditLog, fetchAuditLogs } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatDateTime, redactSensitive } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { useSession } from '@/providers/app-providers';
import type { AuditDetail, AuditListItem } from '@/types/api';

export function AuditPageClient() {
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

  const listQuery = useQuery({
    queryKey: ['audit-logs', companyId, page, action, entityType, entityId],
    enabled: Boolean(companyId) && can(PERMISSIONS.AUDIT_READ),
    queryFn: () =>
      fetchAuditLogs(companyId, {
        page,
        pageSize: 20,
        action: action || undefined,
        entityType: entityType || undefined,
        entityId: entityId || undefined,
      }),
  });

  const detailQuery = useQuery({
    queryKey: ['audit-log', companyId, selectedId],
    enabled: Boolean(companyId && selectedId),
    queryFn: () => fetchAuditLog(companyId, selectedId!),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  if (!can(PERMISSIONS.AUDIT_READ)) {
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
    <div>
      <PageHeader
        title="تاریخچه تغییرات"
        description="رویدادهای ممیزی شرکت فعال"
        breadcrumbs={[{ label: 'هکتور' }, { label: 'کنترل' }, { label: 'تاریخچه تغییرات' }]}
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
          <Input
            id="entityType"
            name="entityType"
            defaultValue={entityType}
            dir="ltr"
            className="text-start"
          />
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
        <div className="flex items-end gap-2 md:col-span-1">
          <Button type="submit">اعمال فیلتر</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.replace(pathname)}
          >
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
        <EmptyState title="هیچ رویداد Audit با این فیلتر پیدا نشد." />
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
                      <Badge className="font-mono">{row.action}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{row.entityType}</td>
                    <td className="px-3 py-2 font-mono text-xs">{row.entityId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>
              صفحه {listQuery.data.meta.page} از {listQuery.data.meta.totalPages} ({listQuery.data.meta.total} رکورد)
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
        title="جزئیات Audit"
        description="وضعیت قبل و بعد از تغییر"
        className="max-w-2xl"
      >
        {detailQuery.isLoading ? <TableSkeleton rows={3} /> : null}
        {detailQuery.data ? <AuditDetailView detail={detailQuery.data} /> : null}
        {detailQuery.error ? (
          <ErrorState
            message={isApiClientError(detailQuery.error) ? detailQuery.error.message : undefined}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function AuditDetailView({ detail }: { detail: AuditDetail }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="عملیات" value={detail.action} mono />
        <Field label="زمان" value={formatDateTime(detail.createdAt)} />
        <Field label="کاربر" value={detail.actor.displayName ?? detail.actor.email ?? '—'} />
        <Field label="موجودیت" value={`${detail.entityType} / ${detail.entityId ?? '—'}`} mono />
        <Field label="requestId" value={detail.requestId ?? '—'} mono />
        <Field label="IP" value={detail.ipAddress ?? '—'} mono />
      </div>
      <Field label="User-Agent" value={detail.userAgent ?? '—'} />
      <JsonBlock title="قبل" value={detail.before} />
      <JsonBlock title="بعد" value={detail.after} />
      <JsonBlock title="metadata" value={detail.metadata} />
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={mono ? 'font-mono text-xs break-all' : ''}>{value}</div>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-500">{title}</div>
      <pre className="max-h-56 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100" dir="ltr">
        {JSON.stringify(redactSensitive(value), null, 2)}
      </pre>
    </div>
  );
}
