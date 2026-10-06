'use client';

import * as React from 'react';
import Link from 'next/link';
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
import { fetchCompany, updateCompany } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatRequestIdHint, mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { companyKeys } from '@/lib/query/keys';
import { ROUTES, auditEntityPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const schema = z.object({
  name: z.string().trim().min(1, 'نام شرکت الزامی است').max(120),
  timezone: z.string().trim().min(1, 'منطقه زمانی الزامی است').max(64),
});

type FormValues = z.infer<typeof schema>;

export function CompanySettingsPageClient() {
  const { activeCompany, can, reloadCompanies, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.COMPANY_READ);
  const canUpdate = can(PERMISSIONS.COMPANY_UPDATE);
  const canAudit = can(PERMISSIONS.AUDIT_READ);
  const loadedCompanyId = React.useRef(companyId);

  React.useEffect(() => {
    loadedCompanyId.current = companyId;
  }, [companyId]);

  const companyQuery = useQuery({
    queryKey: companyKeys.detail(companyId),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchCompany(companyId),
  });

  React.useEffect(() => {
    if (
      companyQuery.error &&
      isApiClientError(companyQuery.error) &&
      companyQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [companyQuery.error, handleUnauthorized]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', timezone: '' },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = form;

  React.useEffect(() => {
    if (companyQuery.data) {
      reset({
        name: companyQuery.data.name,
        timezone: companyQuery.data.timezone,
      });
    }
  }, [companyQuery.data, reset]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (loadedCompanyId.current !== companyId) {
        throw new Error('COMPANY_CONTEXT_CHANGED');
      }
      return updateCompany(companyId, values);
    },
    onSuccess: async () => {
      toast.success('تنظیمات شرکت ذخیره شد.');
      await queryClient.invalidateQueries({ queryKey: companyKeys.detail(companyId) });
      await reloadCompanies();
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'COMPANY_CONTEXT_CHANGED') {
        toast.error('شرکت فعال تغییر کرده است. صفحه را دوباره بارگذاری کنید.');
        return;
      }
      const message = mapBusinessError(error, 'ذخیره تنظیمات ناموفق بود.');
      const hint =
        isApiClientError(error) && error.requestId
          ? formatRequestIdHint(error.requestId)
          : null;
      toast.error(hint ? `${message}\n${hint}` : message);
    },
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  if (companyQuery.isLoading) {
    return <PageSkeleton />;
  }

  if (companyQuery.error) {
    if (isApiClientError(companyQuery.error) && companyQuery.error.status === 403) {
      return <AccessDenied />;
    }
    return (
      <ErrorState
        message={isApiClientError(companyQuery.error) ? companyQuery.error.message : undefined}
        requestId={isApiClientError(companyQuery.error) ? companyQuery.error.requestId : undefined}
        onRetry={() => void companyQuery.refetch()}
      />
    );
  }

  const company = companyQuery.data!;

  return (
    <div>
      <PageHeader
        title="تنظیمات شرکت"
        description={company.name}
        breadcrumbs={[
          { label: 'تنظیمات', href: ROUTES.settings },
          { label: 'شرکت' },
        ]}
        actions={
          canAudit ? (
            <Link
              href={auditEntityPath('COMPANY', company.id)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium hover:bg-slate-50"
            >
              مشاهده تاریخچه تغییرات
            </Link>
          ) : null
        }
      />

      <form
        className="max-w-xl space-y-4 rounded-lg border border-slate-200 bg-white p-4"
        onSubmit={handleSubmit((values) => {
          if (!canUpdate || !isDirty) return;
          mutation.mutate(values);
        })}
      >
        <div>
          <Label htmlFor="company-name">نام</Label>
          <Input
            id="company-name"
            {...register('name')}
            disabled={!canUpdate}
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name ? (
            <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="company-timezone">منطقه زمانی</Label>
          <Input
            id="company-timezone"
            {...register('timezone')}
            disabled={!canUpdate}
            dir="ltr"
            className="text-start"
            aria-invalid={Boolean(errors.timezone)}
          />
          {errors.timezone ? (
            <p className="mt-1 text-xs text-red-600">{errors.timezone.message}</p>
          ) : null}
        </div>
        <div className="grid gap-2 text-sm text-slate-500 sm:grid-cols-2">
          <div>
            <div className="text-xs">Slug</div>
            <div className="font-mono" dir="ltr">
              {company.slug}
            </div>
          </div>
          <div>
            <div className="text-xs">ارز پایه</div>
            <div className="font-mono" dir="ltr">
              {company.baseCurrency}
            </div>
          </div>
        </div>
        {canUpdate ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={!isDirty || mutation.isPending || isSubmitting}
            >
              {mutation.isPending ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!isDirty || mutation.isPending}
              onClick={() =>
                reset({
                  name: company.name,
                  timezone: company.timezone,
                })
              }
            >
              بازنشانی تغییرات
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">شما مجوز ویرایش شرکت را ندارید.</p>
        )}
      </form>
    </div>
  );
}
