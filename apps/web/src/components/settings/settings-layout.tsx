'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { AccessDenied } from '@/components/feedback/states';
import {
  SETTINGS_NAV,
  filterSettingsNav,
  resolveSettingsSection,
  settingsSectionAccessible,
} from '@/features/settings/settings-nav-config';
import { ROUTES } from '@/lib/utils/routes';
import { cn } from '@/lib/utils/cn';
import { useSession } from '@/providers/app-providers';

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { can, activeCompany } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const items = filterSettingsNav(SETTINGS_NAV, can);
  const section = resolveSettingsSection(pathname);
  const accessible = settingsSectionAccessible(section, can);
  const previousCompanyId = React.useRef(activeCompany?.id);

  React.useEffect(() => {
    const nextId = activeCompany?.id;
    const prevId = previousCompanyId.current;
    previousCompanyId.current = nextId;

    if (!prevId || !nextId || prevId === nextId) return;

    const isDetail =
      /^\/app\/settings\/members\/[^/]+$/.test(pathname) ||
      /^\/app\/settings\/roles\/[^/]+$/.test(pathname) ||
      pathname === ROUTES.settingsRolesNew;

    if (isDetail) {
      if (pathname.startsWith(ROUTES.settingsMembers)) {
        router.replace(ROUTES.settingsMembers);
      } else if (pathname.startsWith(ROUTES.settingsRoles)) {
        router.replace(ROUTES.settingsRoles);
      }
      return;
    }

    if (!settingsSectionAccessible(resolveSettingsSection(pathname), can)) {
      router.replace(ROUTES.settings);
    }
  }, [activeCompany?.id, can, pathname, router]);

  if (!accessible && section !== 'overview') {
    return (
      <SettingsShell items={items} pathname={pathname}>
        <AccessDenied message="شما دسترسی لازم برای این بخش را ندارید." />
      </SettingsShell>
    );
  }

  return (
    <SettingsShell items={items} pathname={pathname}>
      {children}
    </SettingsShell>
  );
}

function SettingsShell({
  items,
  pathname,
  children,
}: {
  items: ReturnType<typeof filterSettingsNav>;
  pathname: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="md:hidden">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">بخش تنظیمات</span>
          <select
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            value={resolveSettingsHref(pathname, items)}
            onChange={(event) => {
              if (event.target.value) {
                router.push(event.target.value);
              }
            }}
          >
            <option value={ROUTES.settings}>نمای کلی</option>
            {items.map((item) => (
              <option key={item.href} value={item.href}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-col gap-6 md:flex-row">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="sticky top-20 space-y-1 rounded-lg border border-slate-200 bg-white p-2">
            <Link
              href={ROUTES.settings}
              className={cn(
                'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === ROUTES.settings
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              تنظیمات
            </Link>
            <nav aria-label="منوی تنظیمات" className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-slate-100 font-medium text-slate-900'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

function resolveSettingsHref(
  pathname: string,
  items: ReturnType<typeof filterSettingsNav>,
): string {
  if (pathname === ROUTES.settings) return ROUTES.settings;
  const match = items.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return match?.href ?? ROUTES.settings;
}
