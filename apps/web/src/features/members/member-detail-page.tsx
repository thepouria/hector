'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { MemberStatusBadge } from '@/features/members/member-status';
import {
  fetchMember,
  fetchRoles,
  removeMember,
  replaceMemberRoles,
  updateMemberStatus,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { displayName, formatDateTime } from '@/lib/formatters';
import { samePermissionSet } from '@/lib/permissions/presentation';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { memberKeys, roleKeys } from '@/lib/query/keys';
import { ROUTES, auditEntityPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function MemberDetailPageClient({ memberId }: { memberId: string }) {
  const router = useRouter();
  const {
    activeCompany,
    can,
    companyMemberId,
    refreshAuthorizationContext,
    handleUnauthorized,
  } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const loadedCompanyId = React.useRef(companyId);
  const [confirm, setConfirm] = React.useState<'suspend' | 'activate' | 'remove' | null>(null);

  React.useEffect(() => {
    loadedCompanyId.current = companyId;
  }, [companyId]);

  const memberQuery = useQuery({
    queryKey: memberKeys.detail(companyId, memberId),
    enabled: Boolean(companyId) && can(PERMISSIONS.MEMBER_READ),
    queryFn: () => fetchMember(companyId, memberId),
  });

  const rolesQuery = useQuery({
    queryKey: roleKeys.list(companyId, { for: 'member-detail' }),
    enabled: Boolean(companyId) && can(PERMISSIONS.ROLE_ASSIGN),
    queryFn: () => fetchRoles(companyId, { page: 1, pageSize: 100 }),
  });

  React.useEffect(() => {
    if (memberQuery.error && isApiClientError(memberQuery.error) && memberQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [memberQuery.error, handleUnauthorized]);

  const [roleIds, setRoleIds] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (memberQuery.data) {
      setRoleIds(memberQuery.data.roles.map((role) => role.id));
    }
  }, [memberQuery.data]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: memberKeys.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: memberKeys.detail(companyId, memberId) });
  };

  const rolesMutation = useMutation({
    mutationFn: (nextRoleIds: string[]) => {
      if (loadedCompanyId.current !== companyId) {
        throw new Error('COMPANY_CONTEXT_CHANGED');
      }
      return replaceMemberRoles(companyId, memberId, nextRoleIds);
    },
    onSuccess: async () => {
      toast.success('نقش‌های عضو به‌روز شد.');
      await invalidate();
      if (memberId === companyMemberId) {
        await refreshAuthorizationContext();
      }
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'COMPANY_CONTEXT_CHANGED') {
        toast.error('شرکت فعال تغییر کرده است.');
        router.replace(ROUTES.settingsMembers);
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'ACTIVE' | 'SUSPENDED') => updateMemberStatus(companyId, memberId, status),
    onSuccess: async () => {
      toast.success('وضعیت عضو به‌روز شد.');
      setConfirm(null);
      await invalidate();
      if (memberId === companyMemberId) {
        await refreshAuthorizationContext();
      }
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const removeMutation = useMutation({
    mutationFn: () => removeMember(companyId, memberId),
    onSuccess: async (member) => {
      toast.success('عضویت حذف شد.');
      setConfirm(null);
      await invalidate();
      if (memberId === companyMemberId) {
        await refreshAuthorizationContext();
        return;
      }
      if (member.status === 'REMOVED') {
        // Backend retains membership record as REMOVED.
        await memberQuery.refetch();
      } else {
        router.replace(ROUTES.settingsMembers);
      }
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.MEMBER_READ)) {
    return <AccessDenied />;
  }

  if (memberQuery.isLoading) {
    return <PageSkeleton />;
  }

  if (memberQuery.error) {
    if (isApiClientError(memberQuery.error) && memberQuery.error.status === 403) {
      return <AccessDenied />;
    }
    if (isApiClientError(memberQuery.error) && memberQuery.error.status === 404) {
      return (
        <div className="space-y-4">
          <ErrorState
            title="عضو پیدا نشد"
            message="این عضو در شرکت فعال وجود ندارد یا حذف شده است."
          />
          <Button variant="outline" onClick={() => router.replace(ROUTES.settingsMembers)}>
            بازگشت به فهرست اعضا
          </Button>
        </div>
      );
    }
    return (
      <ErrorState
        message={isApiClientError(memberQuery.error) ? memberQuery.error.message : undefined}
        requestId={isApiClientError(memberQuery.error) ? memberQuery.error.requestId : undefined}
        onRetry={() => void memberQuery.refetch()}
      />
    );
  }

  const member = memberQuery.data!;
  const initialRoleIds = member.roles.map((role) => role.id);
  const rolesDirty = !samePermissionSet(roleIds, initialRoleIds);
  const isSelf = member.id === companyMemberId;

  return (
    <div>
      <PageHeader
        title={displayName(member.user)}
        description={member.user.email}
        breadcrumbs={[
          { label: 'تنظیمات', href: ROUTES.settings },
          { label: 'اعضا', href: ROUTES.settingsMembers },
          { label: displayName(member.user) },
        ]}
        actions={
          can(PERMISSIONS.AUDIT_READ) ? (
            <Link
              href={auditEntityPath('COMPANY_MEMBER', member.id)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium hover:bg-slate-50"
            >
              مشاهده تاریخچه این عضو
            </Link>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <Field label="وضعیت">
          <MemberStatusBadge status={member.status} />
        </Field>
        <Field label="تاریخ عضویت">{formatDateTime(member.joinedAt)}</Field>
        <Field label="ایمیل">
          <span dir="ltr">{member.user.email}</span>
        </Field>
        <Field label="نام">{displayName(member.user)}</Field>
      </div>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">نقش‌ها</h2>
        <p className="mt-1 text-sm text-slate-500">
          نقش‌های این عضو تعیین می‌کنند به چه بخش‌هایی از Hector دسترسی دارد.
        </p>
        {can(PERMISSIONS.ROLE_ASSIGN) && member.status !== 'REMOVED' ? (
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!rolesDirty) return;
              if (isSelf) {
                const confirmed = window.confirm(
                  'در حال ویرایش نقش‌های خودتان هستید. ممکن است دسترسی شما بلافاصله تغییر کند. ادامه می‌دهید؟',
                );
                if (!confirmed) return;
              }
              rolesMutation.mutate(roleIds);
            }}
          >
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3">
              {(rolesQuery.data?.data ?? []).map((role) => {
                const checked = roleIds.includes(role.id);
                return (
                  <label key={role.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setRoleIds(
                          checked
                            ? roleIds.filter((id) => id !== role.id)
                            : [...roleIds, role.id],
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
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={!rolesDirty || rolesMutation.isPending || roleIds.length === 0}>
                {rolesMutation.isPending ? 'در حال ذخیره...' : 'ذخیره نقش‌ها'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!rolesDirty || rolesMutation.isPending}
                onClick={() => setRoleIds(initialRoleIds)}
              >
                بازنشانی تغییرات
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {member.roles.map((role) => (
              <span
                key={role.id}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-sm"
              >
                {role.name}
              </span>
            ))}
          </div>
        )}
      </section>

      {member.status !== 'REMOVED' ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">اقدامات</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {can(PERMISSIONS.MEMBER_UPDATE) && member.status === 'ACTIVE' ? (
              <Button variant="outline" onClick={() => setConfirm('suspend')}>
                تعلیق
              </Button>
            ) : null}
            {can(PERMISSIONS.MEMBER_UPDATE) && member.status === 'SUSPENDED' ? (
              <Button variant="outline" onClick={() => setConfirm('activate')}>
                فعال‌سازی مجدد
              </Button>
            ) : null}
            {can(PERMISSIONS.MEMBER_REMOVE) ? (
              <Button variant="danger" onClick={() => setConfirm('remove')}>
                حذف دسترسی
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm === 'remove'
            ? 'حذف دسترسی'
            : confirm === 'suspend'
              ? 'تعلیق عضو'
              : 'فعال‌سازی مجدد'
        }
        description={
          confirm === 'remove'
            ? isSelf
              ? `با حذف دسترسی خودتان از شرکت «${activeCompany?.name ?? ''}»، دسترسی شما به این شرکت بلافاصله قطع می‌شود.`
              : `با حذف دسترسی، عضویت «${displayName(member.user)}» در شرکت «${activeCompany?.name ?? ''}» قطع می‌شود.`
            : confirm === 'suspend'
              ? isSelf
                ? 'با تعلیق خودتان، دسترسی شما به شرکت متوقف می‌شود.'
                : 'با تعلیق این عضو، دسترسی او به شرکت متوقف می‌شود تا دوباره فعال شود.'
              : 'این عضو دوباره به شرکت دسترسی خواهد داشت.'
        }
        target={`${displayName(member.user)} · ${member.user.email}`}
        confirmLabel={
          confirm === 'remove' ? 'حذف دسترسی' : confirm === 'suspend' ? 'تعلیق' : 'فعال‌سازی'
        }
        danger={confirm === 'remove' || confirm === 'suspend'}
        loading={statusMutation.isPending || removeMutation.isPending}
        onConfirm={() => {
          if (confirm === 'remove') {
            removeMutation.mutate();
            return;
          }
          if (confirm === 'suspend') {
            statusMutation.mutate('SUSPENDED');
            return;
          }
          if (confirm === 'activate') {
            statusMutation.mutate('ACTIVE');
          }
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{children}</div>
    </div>
  );
}
