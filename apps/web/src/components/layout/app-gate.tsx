'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { CompanySwitcher } from '@/components/navigation/chrome';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function AppGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, companies, activeCompany, bootstrapError, reloadCompanies } = useSession();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(ROUTES.login);
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md">
          <PageSkeleton />
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return null;
  }

  if (bootstrapError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg">
          <ErrorState
            message={bootstrapError}
            onRetry={() => {
              void reloadCompanies();
              window.location.reload();
            }}
          />
        </div>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold">بدون دسترسی شرکتی</h1>
          <p className="mt-2 text-sm text-slate-500">
            در حال حاضر به هیچ شرکتی دسترسی ندارید. با مدیر سیستم تماس بگیرید.
          </p>
        </div>
      </div>
    );
  }

  if (!activeCompany && companies.length > 1) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-6">
          <div>
            <h1 className="text-lg font-semibold">انتخاب شرکت</h1>
            <p className="mt-1 text-sm text-slate-500">
              برای ادامه کار، شرکت فعال را انتخاب کنید.
            </p>
          </div>
          <CompanySwitcher />
          <p className="text-xs text-slate-400">مسیر فعلی: {pathname}</p>
        </div>
      </div>
    );
  }

  if (!activeCompany) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md space-y-3 rounded-lg border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm text-slate-600">شرکت فعالی انتخاب نشده است.</p>
          <Button onClick={() => void reloadCompanies()}>بارگذاری مجدد</Button>
        </div>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
