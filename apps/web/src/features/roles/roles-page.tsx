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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { RowActionsMenu } from '@/components/ui/row-actions';
import { deleteRole, fetchRoles } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { roleKeys } from '@/lib/query/keys';
import { ROUTES, settingsRolePath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { Role } from '@/types/api';

export function RolesPageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const [deleteTarget, setDeleteTarget] = React.useState<Role | null>(null);

  const rolesQuery = useQuery({
    queryKey: roleKeys.list(companyId),
    enabled: Boolean(companyId) && can(PERMISSIONS.ROLE_READ),
    queryFn: () => fetchRoles(companyId, { page: 1, pageSize: 100 }),
  });

  React.useEffect(() => {
    if (rolesQuery.error && isApiClientError(rolesQuery.error) && rolesQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [rolesQuery.error, handleUnauthorized]);

  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => deleteRole(companyId, roleId),
    onSuccess: async () => {
      toast.success('نقش حذف شد.');
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: roleKeys.all(companyId) });
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.ROLE_READ)) {
    return <AccessDenied />;
  }

  return (
    <div>
      <PageHeader
        title="نقش‌ها و دسترسی‌ها"
        description="تعریف نقش‌ها و کنترل دسترسی شرکت"
        breadcrumbs={[
          { label: 'تنظیمات', href: ROUTES.settings },
          { label: 'نقش‌ها' },
        ]}
        actions={
          can(PERMISSIONS.ROLE_CREATE) ? (
            <Button onClick={() => router.push(ROUTES.settingsRolesNew)}>نقش جدید</Button>
          ) : null
        }
      />

      {rolesQuery.isLoading ? <TableSkeleton /> : null}
      {rolesQuery.error ? (
        isApiClientError(rolesQuery.error) && rolesQuery.error.status === 403 ? (
          <AccessDenied />
        ) : (
          <ErrorState
            message={isApiClientError(rolesQuery.error) ? rolesQuery.error.message : undefined}
            requestId={isApiClientError(rolesQuery.error) ? rolesQuery.error.requestId : undefined}
            onRetry={() => void rolesQuery.refetch()}
          />
        )
      ) : null}

      {rolesQuery.data && rolesQuery.data.data.length === 0 ? (
        <EmptyState
          title="هنوز نقش سفارشی ایجاد نشده است."
          action={
            can(PERMISSIONS.ROLE_CREATE) ? (
              <Button onClick={() => router.push(ROUTES.settingsRolesNew)}>ایجاد نقش</Button>
            ) : null
          }
        />
      ) : null}

      {rolesQuery.data && rolesQuery.data.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">نام نقش</th>
                <th className="px-3 py-2 text-start font-medium">کلید</th>
                <th className="px-3 py-2 text-start font-medium">نوع</th>
                <th className="px-3 py-2 text-start font-medium">تعداد دسترسی‌ها</th>
                <th className="px-3 py-2 text-start font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rolesQuery.data.data.map((role) => (
                <tr key={role.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link
                      href={settingsRolePath(role.id)}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {role.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {role.key}
                  </td>
                  <td className="px-3 py-2">
                    <Badge>{role.isSystem ? 'سیستمی' : 'سفارشی'}</Badge>
                  </td>
                  <td className="px-3 py-2">{role.permissions.length}</td>
                  <td className="px-3 py-2">
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'مشاهده / ویرایش',
                          onSelect: () => router.push(settingsRolePath(role.id)),
                        },
                        ...(can(PERMISSIONS.ROLE_DELETE) && !role.isSystem
                          ? [
                              {
                                label: 'حذف نقش',
                                danger: true,
                                onSelect: () => setDeleteTarget(role),
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
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="حذف نقش"
        description="اعضایی که این نقش را دارند ممکن است دسترسی‌شان تغییر کند. رفتار دقیق توسط سرور تعیین می‌شود."
        target={deleteTarget ? `${deleteTarget.name} (${deleteTarget.key})` : undefined}
        confirmLabel="حذف نقش"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}
