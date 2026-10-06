'use client';

import * as React from 'react';
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { BrandMark, CompanySwitcher, NavLink, UserMenu } from '@/components/navigation/chrome';
import { filterNavigation, NAVIGATION } from '@/components/navigation/nav-config';
import { Button } from '@/components/ui/button';
import { useSession } from '@/providers/app-providers';
import { cn } from '@/lib/utils/cn';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { can } = useSession();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const groups = filterNavigation(NAVIGATION, can);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 flex-col border-e border-slate-200 bg-white md:flex',
            collapsed ? 'w-[72px]' : 'w-64',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
            <BrandMark collapsed={collapsed} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={collapsed ? 'گسترش منو' : 'جمع کردن منو'}
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </div>
          {!collapsed ? (
            <div className="border-b border-slate-100 px-3 py-3">
              <CompanySwitcher />
            </div>
          ) : null}
          <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
            {groups.map((group) => (
              <div key={group.label}>
                {!collapsed ? (
                  <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    {group.label}
                  </div>
                ) : null}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.href}
                      href={item.href}
                      label={collapsed ? '' : item.label}
                      icon={item.icon}
                      title={item.label}
                      exact={item.exact}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
            <div className="flex items-center gap-2 md:hidden">
              <Button
                variant="outline"
                size="icon"
                aria-label="باز کردن منو"
                onClick={() => setMobileOpen(true)}
              >
                <Menu className="h-4 w-4" />
              </Button>
              <BrandMark />
            </div>
            <div className="ms-auto flex items-center gap-3">
              <div className="hidden w-48 md:block lg:hidden">
                <CompanySwitcher compact />
              </div>
              <UserMenu />
            </div>
          </header>

          <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>
        </div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="بستن منو"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 start-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
              <BrandMark />
              <Button
                variant="ghost"
                size="icon"
                aria-label="بستن"
                onClick={() => setMobileOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="border-b border-slate-100 px-3 py-3">
              <CompanySwitcher />
            </div>
            <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
              {groups.map((group) => (
                <div key={group.label}>
                  <div className="mb-1 px-2 text-[11px] font-semibold text-slate-400">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.href}
                        href={item.href}
                        label={item.label}
                        icon={item.icon}
                        exact={item.exact}
                        onNavigate={() => setMobileOpen(false)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
