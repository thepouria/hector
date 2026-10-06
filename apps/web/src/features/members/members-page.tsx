'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import { MemberStatusBadge } from '@/features/members/member-status';
import {
  createMember,
  fetchMembers,
  fetchRoles,
  removeMember,
  updateMemberStatus,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { displayName, formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { memberKeys, roleKeys } from '@/lib/query/keys';
import { ROUTES, settingsMemberPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { Member } from '@/types/api';

export function MembersPageClient() {
  const router = useRouter();
  const { activeCompany, can, refreshAuthorizationContext, handleUnauthorized, companyMemberId } =
    useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<
    | { type: 'suspend' | 'activate' | 'remove'; member: Member }
    | null
  >(null);

  const filters = { page, pageSize: 20, search: search || undefined, status: status || undefined };

  const membersQuery = useQuery({
    queryKey: memberKeys.list(companyId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.MEMBER_READ),
    queryFn: () => fetchMembers(companyId, filters),
  });

  const rolesQuery = useQuery({
    queryKey: roleKeys.list(companyId, { for: 'member-create' }),
    enabled: Boolean(companyId) && createOpen,
    queryFn: () => fetchRoles(companyId, { page: 1, pageSize: 100 }),
  });

  React.useEffect(() => {
    if (
      membersQuery.error &&
      isApiClientError(membersQuery.error) &&
      membersQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [membersQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: memberKeys.all(companyId) });
  };

  const statusMutation = useMutation({
    mutationFn: ({ memberId, nextStatus }: { memberId: string; nextStatus: 'ACTIVE' | 'SUSPENDED' }) =>
      updateMemberStatus(companyId, memberId, nextStatus),
    onSuccess: async (_data, variables) => {
      toast.success('وضعیت عضو به‌روز شد.');
      setConfirm(null);
      await invalidate();
      if (variables.memberId === companyMemberId) {
        await refreshAuthorizationContext();
      }
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => removeMember(companyId, memberId),
    onSuccess: async (_data, memberId) => {
      toast.success('عضویت حذف شد.');
      setConfirm(null);
      await invalidate();
      if (memberId === companyMemberId) {
        await refreshAuthorizationContext();
      }
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const createMutation = useMutation({
    mutationFn: (body: { email: string; roleIds: string[] }) => createMember(companyId, body),
    onSuccess: async () => {
      toast.success('عضو اضافه شد.');
      setCreateOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.MEMBER_READ)) {
    return <AccessDenied />;
  }

  return (
    <div>
      <PageHeader
        title="اعضا"
        description="مدیریت دسترسی اعضای شرکت"
        breadcrumbs={[
          { label: 'تنظیمات', href: ROUTES.settings },
          { label: 'اعضا' },
        ]}
        actions={
          can(PERMISSIONS.MEMBER_CREATE) ? (
            <Button onClick={() => setCreateOpen(true)}>افزودن عضو</Button>
          ) : null
        }
      />

      <form
        className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setSearch(String(form.get('search') ?? '').trim());
          setStatus(String(form.get('status') ?? ''));
          setPage(1);
        }}
      >
        <div className="flex-1">
          <Label htmlFor="member-search" className="sr-only">
            جستجو
          </Label>
          <Input
            id="member-search"
            name="search"
            placeholder="جستجو بر اساس نام یا ایمیل"
            defaultValue={search}
          />
        </div>
        <div>
          <Label htmlFor="member-status" className="sr-only">
            وضعیت
          </Label>
          <select
            id="member-status"
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">همه وضعیت‌ها</option>
            <option value="ACTIVE">فعال</option>
            <option value="SUSPENDED">تعلیق‌شده</option>
            <option value="REMOVED">حذف‌شده</option>
          </select>
        </div>
        <Button type="submit" variant="outline">
          اعمال
        </Button>
      </form>

      {membersQuery.isLoading ? <TableSkeleton /> : null}
      {membersQuery.error ? (
        isApiClientError(membersQuery.error) && membersQuery.error.status === 403 ? (
          <AccessDenied />
        ) : (
          <ErrorState
            message={isApiClientError(membersQuery.error) ? membersQuery.error.message : undefined}
            requestId={
              isApiClientError(membersQuery.error) ? membersQuery.error.requestId : undefined
            }
            onRetry={() => void membersQuery.refetch()}
          />
        )
      ) : null}

      {membersQuery.data && membersQuery.data.data.length === 0 ? (
        <EmptyState
          title="عضوی با این فیلتر پیدا نشد."
          action={
            can(PERMISSIONS.MEMBER_CREATE) ? (
              <Button onClick={() => setCreateOpen(true)}>افزودن عضو</Button>
            ) : null
          }
        />
      ) : null}

      {membersQuery.data && membersQuery.data.data.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">عضو</th>
                  <th className="px-3 py-2 text-start font-medium">ایمیل</th>
                  <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                  <th className="px-3 py-2 text-start font-medium">نقش‌ها</th>
                  <th className="px-3 py-2 text-start font-medium">تاریخ عضویت</th>
                  <th className="px-3 py-2 text-start font-medium">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {membersQuery.data.data.map((member) => (
                  <tr key={member.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        href={settingsMemberPath(member.id)}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {displayName(member.user)}
                      </Link>
                    </td>
                    <td className="px-3 py-2" dir="ltr">
                      {member.user.email}
                    </td>
                    <td className="px-3 py-2">
                      <MemberStatusBadge status={member.status} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1 text-xs text-slate-600">
                        {member.roles.map((role) => (
                          <span
                            key={role.id}
                            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5"
                          >
                            {role.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTime(member.joinedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <RowActionsMenu
                        actions={[
                          {
                            label: 'مشاهده',
                            onSelect: () => router.push(settingsMemberPath(member.id)),
                          },
                          ...(can(PERMISSIONS.MEMBER_UPDATE) && member.status === 'ACTIVE'
                            ? [
                                {
                                  label: 'تعلیق',
                                  onSelect: () => setConfirm({ type: 'suspend', member }),
                                },
                              ]
                            : []),
                          ...(can(PERMISSIONS.MEMBER_UPDATE) && member.status === 'SUSPENDED'
                            ? [
                                {
                                  label: 'فعال‌سازی مجدد',
                                  onSelect: () => setConfirm({ type: 'activate', member }),
                                },
                              ]
                            : []),
                          ...(can(PERMISSIONS.MEMBER_REMOVE) && member.status !== 'REMOVED'
                            ? [
                                {
                                  label: 'حذف دسترسی',
                                  danger: true,
                                  onSelect: () => setConfirm({ type: 'remove', member }),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>
              صفحه {membersQuery.data.meta.page} از {membersQuery.data.meta.totalPages} (
              {membersQuery.data.meta.total} عضو)
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                قبلی
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= membersQuery.data.meta.totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                بعدی
              </Button>
            </div>
          </div>
        </>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="افزودن عضو">
        <CreateMemberForm
          roles={rolesQuery.data?.data ?? []}
          loading={createMutation.isPending}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.type === 'remove'
            ? 'حذف دسترسی'
            : confirm?.type === 'suspend'
              ? 'تعلیق عضو'
              : 'فعال‌سازی مجدد'
        }
        description={
          confirm?.type === 'remove'
            ? `با حذف دسترسی، عضویت «${displayName(confirm.member.user)}» در شرکت «${activeCompany?.name ?? ''}» قطع می‌شود.`
            : confirm?.type === 'suspend'
              ? 'با تعلیق این عضو، دسترسی او به شرکت متوقف می‌شود تا دوباره فعال شود.'
              : 'این عضو دوباره به شرکت دسترسی خواهد داشت.'
        }
        target={
          confirm
            ? `${displayName(confirm.member.user)} · ${confirm.member.user.email}`
            : undefined
        }
        confirmLabel={
          confirm?.type === 'remove'
            ? 'حذف دسترسی'
            : confirm?.type === 'suspend'
              ? 'تعلیق'
              : 'فعال‌سازی'
        }
        danger={confirm?.type === 'remove' || confirm?.type === 'suspend'}
        loading={statusMutation.isPending || removeMutation.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.type === 'remove') {
            removeMutation.mutate(confirm.member.id);
            return;
          }
          statusMutation.mutate({
            memberId: confirm.member.id,
            nextStatus: confirm.type === 'suspend' ? 'SUSPENDED' : 'ACTIVE',
          });
        }}
      />
    </div>
  );
}

function CreateMemberForm({
  roles,
  loading,
  onSubmit,
}: {
  roles: Array<{ id: string; name: string; key: string }>;
  loading: boolean;
  onSubmit: (values: { email: string; roleIds: string[] }) => void;
}) {
  const [email, setEmail] = React.useState('');
  const [roleIds, setRoleIds] = React.useState<string[]>([]);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ email: email.trim(), roleIds });
      }}
    >
      <div>
        <Label htmlFor="member-email">ایمیل کاربر موجود</Label>
        <Input
          id="member-email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          dir="ltr"
          className="text-start"
          required
        />
      </div>
      <div className="space-y-2">
        <Label>نقش‌های اولیه</Label>
        <p className="text-xs text-slate-500">
          نقش‌های این عضو تعیین می‌کنند به چه بخش‌هایی از Hector دسترسی دارد.
        </p>
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3">
          {roles.map((role) => {
            const checked = roleIds.includes(role.id);
            return (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    setRoleIds(
                      checked ? roleIds.filter((id) => id !== role.id) : [...roleIds, role.id],
                    );
                  }}
                />
                <span>
                  {role.name}{' '}
                  <span className="font-mono text-xs text-slate-400" dir="ltr">
                    ({role.key})
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <Button type="submit" disabled={loading || roleIds.length === 0 || !email.trim()}>
        {loading ? 'در حال ذخیره...' : 'افزودن'}
      </Button>
    </form>
  );
}
