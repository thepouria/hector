'use client';

import Link from 'next/link';
import {
  SETTINGS_NAV,
  filterSettingsNav,
} from '@/features/settings/settings-nav-config';
import { PageHeader } from '@/components/layout/page-header';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import { cn } from '@/lib/utils/cn';

export function SettingsOverviewPage() {
  const { can, activeCompany } = useSession();
  const items = filterSettingsNav(SETTINGS_NAV, can);

  return (
    <div>
      <PageHeader
        title="تنظیمات"
        description={
          activeCompany
            ? `کنترل دسترسی و پیکربندی شرکت «${activeCompany.name}»`
            : 'کنترل دسترسی و پیکربندی حساب'
        }
        breadcrumbs={[
          { label: 'هکتور', href: ROUTES.dashboard },
          { label: 'تنظیمات' },
        ]}
      />

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">بخش قابل دسترسی در تنظیمات وجود ندارد.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <Icon className="h-4 w-4 text-slate-700" aria-hidden />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <p className="mt-1 text-sm text-slate-500">{item.description}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
