'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionSelector } from '@/features/roles/permission-selector';
import {
  deleteRole,
  fetchPermissions,
  fetchRole,
  replaceRolePermissions,
  updateRole,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { samePermissionSet } from '@/lib/permissions/presentation';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { roleKeys } from '@/lib/query/keys';
import { ROUTES, auditEntityPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const metaSchema = z.object({
  name: z.string().trim().min(1, 'نام نقش الزامی است').max(120),
  description: z.string().trim().max(500).optional(),
});

type MetaValues = z.infer<typeof metaSchema>;

export function RoleDetailPageClient({ roleId }: { roleId: string }) {
  const router = useRouter();
  const {
    activeCompany,
    can,
    permissions,
    roles: myRoles,
    refreshAuthorizationContext,
    handleUnauthorized,
  } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const loadedCompanyId = React.useRef(companyId);
  const [permissionIds, setPermissionIds] = React.useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  React.useEffect(() => {
    loadedCompanyId.current = companyId;
  }, [companyId]);

  const roleQuery = useQuery({
    queryKey: roleKeys.detail(companyId, roleId),
    enabled: Boolean(companyId) && can(PERMISSIONS.ROLE_READ),
    queryFn: () => fetchRole(companyId, roleId),
  });

  const permissionsQuery = useQuery({
    queryKey: roleKeys.permissionsCatalog(companyId),
    enabled:
      Boolean(companyId) &&
      (can(PERMISSIONS.ROLE_PERMISSIONS_UPDATE) || can(PERMISSIONS.PERMISSION_READ)),
    queryFn: () => fetchPermissions(companyId),
  });

  React.useEffect(() => {
    if (roleQuery.error && isApiClientError(roleQuery.error) && roleQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [roleQuery.error, handleUnauthorized]);

  React.useEffect(() => {
    if (roleQuery.data) {
      setPermissionIds(roleQuery.data.permissions.map((permission) => permission.id));
    }
  }, [roleQuery.data]);

  const form = useForm<MetaValues>({
    resolver: zodResolver(metaSchema),
    defaultValues: { name: '', description: '' },
  });

  React.useEffect(() => {
    if (roleQuery.data) {
      form.reset({
        name: roleQuery.data.name,
        description: roleQuery.data.description ?? '',
      });
    }
  }, [roleQuery.data, form]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: roleKeys.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: roleKeys.detail(companyId, roleId) });
  };

  const updateMutation = useMutation({
    mutationFn: (values: MetaValues) => {
      if (loadedCompanyId.current !== companyId) {
        throw new Error('COMPANY_CONTEXT_CHANGED');
      }
      return updateRole(companyId, roleId, {
        name: values.name,
        description: values.description || null,
      });
    },
    onSuccess: async () => {
      toast.success('نقش به‌روز شد.');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'COMPANY_CONTEXT_CHANGED') {
        toast.error('شرکت فعال تغییر کرده است.');
        router.replace(ROUTES.settingsRoles);
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const permsMutation = useMutation({
    mutationFn: (nextIds: string[]) => {
      if (loadedCompanyId.current !== companyId) {
        throw new Error('COMPANY_CONTEXT_CHANGED');
      }
      return replaceRolePermissions(companyId, roleId, nextIds);
    },
    onSuccess: async () => {
      toast.success('دسترسی‌های نقش به‌روز شد.');
      await invalidate();
      if (myRoles.some((role) => role.id === roleId)) {
        await refreshAuthorizationContext();
      }
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'COMPANY_CONTEXT_CHANGED') {
        toast.error('شرکت فعال تغییر کرده است.');
        router.replace(ROUTES.settingsRoles);
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteRole(companyId, roleId),
    onSuccess: async () => {
      toast.success('نقش حذف شد.');
      await queryClient.invalidateQueries({ queryKey: roleKeys.all(companyId) });
      router.replace(ROUTES.settingsRoles);
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  if (!can(PERMISSIONS.ROLE_READ)) {
    return <AccessDenied />;
  }

  if (roleQuery.isLoading) {
    return <PageSkeleton />;
  }

  if (roleQuery.error) {
    if (isApiClientError(roleQuery.error) && roleQuery.error.status === 403) {
      return <AccessDenied />;
    }
    if (isApiClientError(roleQuery.error) && roleQuery.error.status === 404) {
      return (
        <div className="space-y-4">
          <ErrorState
            title="نقش پیدا نشد"
            message="این نقش در شرکت فعال وجود ندارد."
          />
          <Button variant="outline" onClick={() => router.replace(ROUTES.settingsRoles)}>
            بازگشت به فهرست نقش‌ها
          </Button>
        </div>
      );
    }
    return (
      <ErrorState
        message={isApiClientError(roleQuery.error) ? roleQuery.error.message : undefined}
        requestId={isApiClientError(roleQuery.error) ? roleQuery.error.requestId : undefined}
        onRetry={() => void roleQuery.refetch()}
      />
    );
  }

  const role = roleQuery.data!;
  const initialPermissionIds = role.permissions.map((permission) => permission.id);
  const permsDirty = !samePermissionSet(permissionIds, initialPermissionIds);
  const canEditMeta = can(PERMISSIONS.ROLE_UPDATE) && !role.isSystem;
  const canEditPerms = can(PERMISSIONS.ROLE_PERMISSIONS_UPDATE) && !role.isSystem;

  return (
    <div>
      <PageHeader
        title={role.name}
        description={role.description ?? undefined}
        breadcrumbs={[
          { label: 'تنظیمات', href: ROUTES.settings },
          { label: 'نقش‌ها', href: ROUTES.settingsRoles },
          { label: role.name },
        ]}
        actions={
          can(PERMISSIONS.AUDIT_READ) ? (
            <Link
              href={auditEntityPath('ROLE', role.id)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium hover:bg-slate-50"
            >
              مشاهده تاریخچه نقش
            </Link>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge>{role.isSystem ? 'سیستمی' : 'سفارشی'}</Badge>
        <span className="font-mono text-xs text-slate-500" dir="ltr">
          {role.key}
        </span>
      </div>

      {role.isSystem ? (
        <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          این نقش توسط سیستم مدیریت می‌شود و برخی تنظیمات آن قابل تغییر نیست.
        </p>
      ) : null}

      <section className="mb-6 max-w-xl space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">اطلاعات نقش</h2>
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((values) => {
            if (!canEditMeta || !form.formState.isDirty) return;
            updateMutation.mutate(values);
          })}
        >
          <div>
            <Label htmlFor="edit-role-name">نام</Label>
            <Input id="edit-role-name" {...form.register('name')} disabled={!canEditMeta} />
          </div>
          <div>
            <Label htmlFor="edit-role-description">توضیح</Label>
            <Input
              id="edit-role-description"
              {...form.register('description')}
              disabled={!canEditMeta}
            />
          </div>
          <div>
            <Label>کلید</Label>
            <Input value={role.key} disabled dir="ltr" className="text-start font-mono" />
          </div>
          {canEditMeta ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={!form.formState.isDirty || updateMutation.isPending}
              >
                {updateMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!form.formState.isDirty || updateMutation.isPending}
                onClick={() =>
                  form.reset({
                    name: role.name,
                    description: role.description ?? '',
                  })
                }
              >
                بازنشانی تغییرات
              </Button>
            </div>
          ) : null}
        </form>
      </section>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">دسترسی‌ها</h2>
        {canEditPerms ? (
          <div className="space-y-3">
            <PermissionSelector
              catalog={permissionsQuery.data ?? role.permissions}
              value={permissionIds}
              onChange={setPermissionIds}
              grantableKeys={permissions}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!permsDirty || permsMutation.isPending}
                onClick={() => permsMutation.mutate(permissionIds)}
              >
                {permsMutation.isPending ? 'در حال ذخیره...' : 'ذخیره دسترسی‌ها'}
              </Button>
              <Button
                variant="outline"
                disabled={!permsDirty || permsMutation.isPending}
                onClick={() => setPermissionIds(initialPermissionIds)}
              >
                بازنشانی تغییرات
              </Button>
            </div>
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {role.permissions.map((permission) => (
              <li key={permission.id} className="font-mono text-xs" dir="ltr">
                {permission.key}
              </li>
            ))}
          </ul>
        )}
      </section>

      {can(PERMISSIONS.ROLE_DELETE) && !role.isSystem ? (
        <section className="rounded-lg border border-red-100 bg-white p-4">
          <h2 className="text-sm font-semibold text-red-800">حذف نقش</h2>
          <p className="mt-1 text-sm text-slate-600">
            حذف نقش سفارشی ممکن است دسترسی اعضای استفاده‌کننده را تغییر دهد.
          </p>
          <Button className="mt-3" variant="danger" onClick={() => setConfirmDelete(true)}>
            حذف نقش
          </Button>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="حذف نقش"
        description="اعضایی که این نقش را دارند ممکن است دسترسی‌شان تغییر کند."
        target={`${role.name} (${role.key})`}
        confirmLabel="حذف نقش"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </div>
  );
}
