import type { LucideIcon } from 'lucide-react';
import { Building2, Lock, ShieldCheck, Users } from 'lucide-react';
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions/keys';
import { ROUTES } from '@/lib/utils/routes';

export type SettingsNavItem = {
  id: 'overview' | 'company' | 'members' | 'roles' | 'security';
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  permission?: PermissionKey;
};

export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    id: 'company',
    label: 'شرکت',
    description: 'اطلاعات و تنظیمات شرکت',
    href: ROUTES.settingsCompany,
    icon: Building2,
    permission: PERMISSIONS.COMPANY_READ,
  },
  {
    id: 'members',
    label: 'اعضا',
    description: 'مدیریت اعضای شرکت و وضعیت دسترسی',
    href: ROUTES.settingsMembers,
    icon: Users,
    permission: PERMISSIONS.MEMBER_READ,
  },
  {
    id: 'roles',
    label: 'نقش‌ها و دسترسی‌ها',
    description: 'تعریف نقش‌ها و کنترل دسترسی',
    href: ROUTES.settingsRoles,
    icon: ShieldCheck,
    permission: PERMISSIONS.ROLE_READ,
  },
  {
    id: 'security',
    label: 'امنیت',
    description: 'مدیریت نشست‌های حساب کاربری',
    href: ROUTES.settingsSecurity,
    icon: Lock,
  },
];

export function filterSettingsNav(
  items: SettingsNavItem[],
  hasPermission: (permission: PermissionKey | string) => boolean,
): SettingsNavItem[] {
  return items.filter((item) => {
    if (!item.permission) return true;
    return hasPermission(item.permission);
  });
}

export function resolveSettingsSection(pathname: string): SettingsNavItem['id'] | 'overview' {
  if (pathname === ROUTES.settings || pathname === `${ROUTES.settings}/`) {
    return 'overview';
  }
  if (pathname.startsWith(ROUTES.settingsCompany)) return 'company';
  if (pathname.startsWith(ROUTES.settingsMembers)) return 'members';
  if (pathname.startsWith(ROUTES.settingsRoles)) return 'roles';
  if (pathname.startsWith(ROUTES.settingsSecurity)) return 'security';
  return 'overview';
}

export function settingsSectionAccessible(
  section: SettingsNavItem['id'] | 'overview',
  hasPermission: (permission: PermissionKey | string) => boolean,
): boolean {
  if (section === 'overview') return true;
  const item = SETTINGS_NAV.find((entry) => entry.id === section);
  if (!item) return false;
  if (!item.permission) return true;
  return hasPermission(item.permission);
}
