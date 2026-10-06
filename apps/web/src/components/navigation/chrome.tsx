'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsUpDown } from 'lucide-react';
import { useSession } from '@/providers/app-providers';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

export function CompanySwitcher({ compact = false }: { compact?: boolean }) {
  const { companies, activeCompany, switchCompany } = useSession();

  if (companies.length === 0) {
    return null;
  }

  if (companies.length === 1 && activeCompany) {
    return (
      <div
        className={cn(
          'rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800',
          compact && 'px-2 py-1 text-xs',
        )}
      >
        {activeCompany.name}
      </div>
    );
  }

  return (
    <label className="block">
      <span className="sr-only">انتخاب شرکت</span>
      <div className="relative">
        <select
          className={cn(
            'h-9 w-full appearance-none rounded-md border border-slate-200 bg-white pe-8 ps-3 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
            compact && 'h-8 text-xs',
          )}
          value={activeCompany?.id ?? ''}
          onChange={(event) => {
            void switchCompany(event.target.value);
          }}
        >
          <option value="" disabled>
            انتخاب شرکت
          </option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
        <ChevronsUpDown className="pointer-events-none absolute end-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
    </label>
  );
}

export function UserMenu() {
  const { user, logout } = useSession();
  if (!user) return null;

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-end sm:block">
        <div className="text-sm font-medium text-slate-900">
          {user.firstName} {user.lastName}
        </div>
        <div className="text-xs text-slate-500">{user.email}</div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void logout()}>
        خروج
      </Button>
    </div>
  );
}

export function BrandMark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link href="/app/dashboard" className="flex items-center gap-2 px-1 py-1">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">
        H
      </span>
      {!collapsed ? (
        <span>
          <span className="block text-sm font-semibold tracking-wide text-slate-900">HECTOR</span>
          <span className="block text-[11px] text-slate-500">Business OS</span>
        </span>
      ) : null}
    </Link>
  );
}

export function NavLink({
  href,
  label,
  icon: Icon,
  onNavigate,
  title,
  exact = false,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onNavigate?: () => void;
  title?: string;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={title ?? label}
      aria-label={title ?? label}
      className={cn(
        'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        !label && 'justify-center',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label ? <span className="truncate">{label}</span> : null}
    </Link>
  );
}
