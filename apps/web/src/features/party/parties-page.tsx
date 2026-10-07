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
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  PARTY_ROLE_LABELS,
  PARTY_STATUS_LABELS,
  PARTY_TYPE_LABELS,
} from '@/features/party/party-labels';
import { fetchParties } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { partyKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, partyPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { PartyRoleType, PartyStatus, PartyType } from '@/types/party';

const ROLE_OPTIONS: Array<PartyRoleType | ''> = [
  '',
  'SUPPLIER',
  'CUSTOMER',
  'PARTNER',
  'LENDER',
  'BORROWER',
  'CONTACT',
  'EMPLOYEE',
  'OTHER',
];

export function PartiesPage() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.PARTY_READ);
  const canCreate = can(PERMISSIONS.PARTY_CREATE);

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [type, setType] = React.useState<PartyType | ''>('');
  const [status, setStatus] = React.useState<PartyStatus | ''>('ACTIVE');
  const [role, setRole] = React.useState<PartyRoleType | ''>('');

  React.useEffect(() => {
    const t = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const filters = {
    page,
    pageSize: 20,
    search: search || undefined,
    type: type || undefined,
    status: status || undefined,
    role: role || undefined,
    sortBy: 'updatedAt',
    sortDir: 'desc',
  };

  const listQuery = useQuery({
    queryKey: partyKeys.list(companyId, filters),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchParties(companyId, filters),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  if (!canRead) {
    return <AccessDenied message="برای مشاهده اشخاص به مجوز party.read نیاز است." />;
  }

  const rows = listQuery.data?.data ?? [];
  const meta = listQuery.data?.meta;

  return (
    <div className="space-y-4">
      <PageHeader
        title="اشخاص"
        description="شناسهٔ یکتای افراد و سازمان‌هایی که با کسب‌وکار در ارتباط‌اند"
        breadcrumbs={[{ label: 'اشخاص' }]}
        actions={
          canCreate ? (
            <Link href={ROUTES.partyNew} className={cn(buttonVariants())}>
              شخص جدید
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Label htmlFor="party-search">جستجو</Label>
          <Input
            id="party-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="کد، نام، موبایل، ایمیل، شناسه…"
            dir="auto"
          />
        </div>
        <div>
          <Label htmlFor="party-type">نوع</Label>
          <select
            id="party-type"
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            value={type}
            onChange={(e) => {
              setType(e.target.value as PartyType | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="INDIVIDUAL">حقیقی</option>
            <option value="ORGANIZATION">حقوقی</option>
          </select>
        </div>
        <div>
          <Label htmlFor="party-status">وضعیت</Label>
          <select
            id="party-status"
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as PartyStatus | '');
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="ACTIVE">فعال</option>
            <option value="INACTIVE">غیرفعال</option>
            <option value="ARCHIVED">بایگانی</option>
          </select>
        </div>
        <div>
          <Label htmlFor="party-role">نقش</Label>
          <select
            id="party-role"
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            value={role}
            onChange={(e) => {
              setRole(e.target.value as PartyRoleType | '');
              setPage(1);
            }}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r || 'all'} value={r}>
                {r ? PARTY_ROLE_LABELS[r] : 'همه نقش‌ها'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {listQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {listQuery.error ? (
        <ErrorState title="خطا" message={mapBusinessError(listQuery.error)} />
      ) : null}
      {!listQuery.isLoading && rows.length === 0 ? (
        <EmptyState title="شخصی یافت نشد" description="شخص جدید بسازید یا فیلترها را تغییر دهید." />
      ) : null}

      {rows.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-right">کد</th>
                  <th className="px-3 py-2 text-right">نام</th>
                  <th className="px-3 py-2 text-right">نوع</th>
                  <th className="px-3 py-2 text-right">تماس اصلی</th>
                  <th className="px-3 py-2 text-right">نقش‌ها</th>
                  <th className="px-3 py-2 text-right">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {p.partyCode}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={partyPath(p.id)}
                        className="font-medium text-sky-700 hover:underline"
                      >
                        {p.displayName}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <Badge>{PARTY_TYPE_LABELS[p.type]}</Badge>
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {p.primaryMobile ?? p.primaryEmail ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.roles.length === 0 ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          p.roles.map((r) => (
                            <Badge key={r} className="bg-sky-50 text-sky-800">
                              {PARTY_ROLE_LABELS[r]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge>{PARTY_STATUS_LABELS[p.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {meta && meta.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                قبلی
              </Button>
              <span className="text-sm text-slate-600">
                صفحه {meta.page} از {meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                بعدی
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
