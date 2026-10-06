'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionSelector } from '@/features/roles/permission-selector';
import { createRole, fetchPermissions } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { roleKeys } from '@/lib/query/keys';
import { ROUTES, settingsRolePath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const schema = z.object({
  name: z.string().trim().min(1, 'نام نقش الزامی است').max(120),
  key: z
    .string()
    .trim()
    .min(1, 'کلید نقش الزامی است')
    .regex(/^[A-Z][A-Z0-9_]*$/, 'کلید باید حروف بزرگ و زیرخط باشد (مثل SALES_MANAGER)'),
  description: z.string().trim().max(500).optional(),
});

type FormValues = z.infer<typeof schema>;

function deriveRoleKey(name: string): string {
  const ascii = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ascii || 'CUSTOM_ROLE';
}

export function RoleCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can, permissions, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const loadedCompanyId = React.useRef(companyId);
  const [permissionIds, setPermissionIds] = React.useState<string[]>([]);
  const [keyTouched, setKeyTouched] = React.useState(false);

  React.useEffect(() => {
    loadedCompanyId.current = companyId;
  }, [companyId]);

  const permissionsQuery = useQuery({
    queryKey: roleKeys.permissionsCatalog(companyId),
    enabled: Boolean(companyId) && can(PERMISSIONS.ROLE_CREATE),
    queryFn: () => fetchPermissions(companyId),
  });

  React.useEffect(() => {
    if (
      permissionsQuery.error &&
      isApiClientError(permissionsQuery.error) &&
      permissionsQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [permissionsQuery.error, handleUnauthorized]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', key: '', description: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (loadedCompanyId.current !== companyId) {
        throw new Error('COMPANY_CONTEXT_CHANGED');
      }
      return createRole(companyId, {
        name: values.name,
        key: values.key,
        description: values.description || undefined,
        permissionIds,
      });
    },
    onSuccess: async (role) => {
      toast.success('نقش ایجاد شد.');
      await queryClient.invalidateQueries({ queryKey: roleKeys.all(companyId) });
      router.replace(settingsRolePath(role.id));
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

  if (!can(PERMISSIONS.ROLE_CREATE)) {
    return <AccessDenied />;
  }

  if (permissionsQuery.isLoading) {
    return <PageSkeleton />;
  }

  if (permissionsQuery.error) {
    return (
      <ErrorState
        message={
          isApiClientError(permissionsQuery.error) ? permissionsQuery.error.message : undefined
        }
        onRetry={() => void permissionsQuery.refetch()}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="ایجاد نقش"
        description="نقش سفارشی جدید برای شرکت فعال"
        breadcrumbs={[
          { label: 'تنظیمات', href: ROUTES.settings },
          { label: 'نقش‌ها', href: ROUTES.settingsRoles },
          { label: 'جدید' },
        ]}
      />

      <form
        className="max-w-3xl space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div>
          <Label htmlFor="role-name">نام</Label>
          <Input
            id="role-name"
            {...form.register('name', {
              onChange: (event) => {
                if (!keyTouched) {
                  form.setValue('key', deriveRoleKey(event.target.value), {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                }
              },
            })}
          />
          {form.formState.errors.name ? (
            <p className="mt-1 text-xs text-red-600">{form.formState.errors.name.message}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="role-key">کلید</Label>
          <Input
            id="role-key"
            dir="ltr"
            className="text-start font-mono"
            {...form.register('key', {
              onChange: () => setKeyTouched(true),
            })}
          />
          <p className="mt-1 text-xs text-slate-500">
            شناسه پایدار داخلی نقش. پس از ایجاد معمولاً نباید تغییر کند.
          </p>
          {form.formState.errors.key ? (
            <p className="mt-1 text-xs text-red-600">{form.formState.errors.key.message}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="role-description">توضیح</Label>
          <Input id="role-description" {...form.register('description')} />
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">دسترسی‌ها</h2>
          <PermissionSelector
            catalog={permissionsQuery.data ?? []}
            value={permissionIds}
            onChange={setPermissionIds}
            grantableKeys={permissions}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'در حال ایجاد...' : 'ایجاد نقش'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(ROUTES.settingsRoles)}
          >
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
