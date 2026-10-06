import { PERMISSIONS, type PermissionKey } from './keys';

export type PermissionGroupId =
  | 'company'
  | 'members'
  | 'roles'
  | 'permissions'
  | 'audit'
  | 'purchasing'
  | 'finance'
  | 'other';

export type PermissionPresentation = {
  key: string;
  group: PermissionGroupId;
  label: string;
  description: string;
};

export const PERMISSION_GROUP_LABELS: Record<PermissionGroupId, string> = {
  company: 'شرکت',
  members: 'اعضا',
  roles: 'نقش‌ها و دسترسی‌ها',
  permissions: 'فهرست دسترسی‌ها',
  audit: 'تاریخچه تغییرات',
  purchasing: 'خرید',
  finance: 'مالی',
  other: 'سایر',
};

const KNOWN: Record<string, Omit<PermissionPresentation, 'key'>> = {
  [PERMISSIONS.COMPANY_READ]: {
    group: 'company',
    label: 'مشاهده شرکت',
    description: 'مشاهده اطلاعات و تنظیمات شرکت',
  },
  [PERMISSIONS.COMPANY_UPDATE]: {
    group: 'company',
    label: 'ویرایش شرکت',
    description: 'ویرایش نام و تنظیمات شرکت',
  },
  [PERMISSIONS.MEMBER_READ]: {
    group: 'members',
    label: 'مشاهده اعضا',
    description: 'مشاهده فهرست و اطلاعات اعضای شرکت',
  },
  [PERMISSIONS.MEMBER_CREATE]: {
    group: 'members',
    label: 'افزودن عضو',
    description: 'افزودن کاربران موجود به شرکت',
  },
  [PERMISSIONS.MEMBER_UPDATE]: {
    group: 'members',
    label: 'ویرایش عضو',
    description: 'تغییر وضعیت عضویت (فعال/تعلیق)',
  },
  [PERMISSIONS.MEMBER_REMOVE]: {
    group: 'members',
    label: 'حذف عضو',
    description: 'حذف دسترسی عضو از شرکت',
  },
  [PERMISSIONS.ROLE_READ]: {
    group: 'roles',
    label: 'مشاهده نقش‌ها',
    description: 'مشاهده نقش‌ها و دسترسی‌های آن‌ها',
  },
  [PERMISSIONS.ROLE_CREATE]: {
    group: 'roles',
    label: 'ایجاد نقش',
    description: 'ایجاد نقش سفارشی برای شرکت',
  },
  [PERMISSIONS.ROLE_UPDATE]: {
    group: 'roles',
    label: 'ویرایش نقش',
    description: 'ویرایش نام و توضیح نقش',
  },
  [PERMISSIONS.ROLE_DELETE]: {
    group: 'roles',
    label: 'حذف نقش',
    description: 'حذف نقش‌های سفارشی',
  },
  [PERMISSIONS.ROLE_ASSIGN]: {
    group: 'roles',
    label: 'تخصیص نقش',
    description: 'تخصیص نقش به اعضای شرکت',
  },
  [PERMISSIONS.ROLE_PERMISSIONS_UPDATE]: {
    group: 'roles',
    label: 'ویرایش دسترسی‌های نقش',
    description: 'تعیین دسترسی‌های هر نقش',
  },
  [PERMISSIONS.PERMISSION_READ]: {
    group: 'permissions',
    label: 'مشاهده فهرست دسترسی‌ها',
    description: 'مشاهده کاتالوگ دسترسی‌های Hector',
  },
  [PERMISSIONS.AUDIT_READ]: {
    group: 'audit',
    label: 'مشاهده تاریخچه تغییرات',
    description: 'مشاهده رویدادهای ممیزی شرکت',
  },
  [PERMISSIONS.PURCHASING_READ]: {
    group: 'purchasing',
    label: 'مشاهده خرید',
    description: 'مشاهده تأمین‌کنندگان و داده‌های اصلی خرید',
  },
  [PERMISSIONS.PURCHASING_CREATE]: {
    group: 'purchasing',
    label: 'ایجاد تأمین‌کننده',
    description: 'ایجاد تأمین‌کننده جدید',
  },
  [PERMISSIONS.PURCHASING_MANAGE]: {
    group: 'purchasing',
    label: 'مدیریت خرید',
    description: 'ویرایش تأمین‌کنندگان، مخاطبین، یادداشت‌ها و وضعیت؛ ویرایش پیش‌نویس سفارش خرید و ثبت سفارش',
  },
  [PERMISSIONS.PURCHASING_APPROVE]: {
    group: 'purchasing',
    label: 'تأیید سفارش خرید',
    description: 'تأیید پیش‌نویس سفارش‌های خرید',
  },
  [PERMISSIONS.PURCHASING_CANCEL]: {
    group: 'purchasing',
    label: 'لغو سفارش خرید',
    description: 'لغو سفارش‌های خرید',
  },
  [PERMISSIONS.PURCHASING_PO_CORRECT]: {
    group: 'purchasing',
    label: 'اصلاح خرید',
    description: 'اعمال اصلاح کنترل‌شده روی سفارش خرید متعهد',
  },
  [PERMISSIONS.PURCHASING_PO_SHORT_CLOSE]: {
    group: 'purchasing',
    label: 'بستن کسری',
    description: 'بستن مقدار باقی‌مانده‌ای که دیگر از تأمین‌کننده انتظار نمی‌رود',
  },
  [PERMISSIONS.PURCHASING_DISCREPANCY_MANAGE]: {
    group: 'purchasing',
    label: 'مغایرت خرید',
    description: 'ثبت و حل مغایرت‌های مقداری خرید',
  },
  [PERMISSIONS.PURCHASING_RETURN_CREATE]: {
    group: 'purchasing',
    label: 'ایجاد برگشت به تأمین‌کننده',
    description: 'ایجاد پیش‌نویس برگشت کالا به تأمین‌کننده',
  },
  [PERMISSIONS.PURCHASING_RETURN_APPROVE]: {
    group: 'purchasing',
    label: 'تأیید برگشت به تأمین‌کننده',
    description: 'تأیید نیت تجاری برگشت (نه خروج انبار)',
  },
  [PERMISSIONS.PURCHASING_RETURN_CANCEL]: {
    group: 'purchasing',
    label: 'لغو برگشت به تأمین‌کننده',
    description: 'لغو برنامه برگشت کالا',
  },
  [PERMISSIONS.FINANCE_ACCOUNTS_READ]: {
    group: 'finance',
    label: 'مشاهده حساب‌های مالی',
    description: 'مشاهده حساب‌های نقد/بانک/کیف پول و موجودی‌ها',
  },
  [PERMISSIONS.FINANCE_ACCOUNTS_MANAGE]: {
    group: 'finance',
    label: 'مدیریت حساب‌های مالی',
    description: 'ایجاد و مدیریت حساب‌های مالی',
  },
  [PERMISSIONS.FINANCE_TRANSACTIONS_READ]: {
    group: 'finance',
    label: 'مشاهده تراکنش‌های مالی',
    description: 'مشاهده ورود/خروج پول و انتقال‌ها',
  },
  [PERMISSIONS.FINANCE_TRANSACTIONS_CREATE]: {
    group: 'finance',
    label: 'ثبت تراکنش مالی',
    description: 'ایجاد حرکت‌های پولی در چارچوب سیاست مالی',
  },
  [PERMISSIONS.FINANCE_TRANSFERS_READ]: {
    group: 'finance',
    label: 'مشاهده انتقال بین حساب‌ها',
    description: 'مشاهده انتقال‌های هم‌ارز بین حساب‌های مالی',
  },
  [PERMISSIONS.FINANCE_TRANSFERS_CREATE]: {
    group: 'finance',
    label: 'ثبت انتقال بین حساب‌ها',
    description: 'ایجاد، ثبت، لغو و برگشت انتقال بین حساب‌ها',
  },
  [PERMISSIONS.FINANCE_CAPITAL_READ]: {
    group: 'finance',
    label: 'مشاهده سرمایه',
    description: 'مشاهده آورده سرمایه شرکا/مالکان',
  },
  [PERMISSIONS.FINANCE_CAPITAL_MANAGE]: {
    group: 'finance',
    label: 'ثبت سرمایه',
    description: 'ثبت آورده سرمایه (نه درآمد)',
  },
  [PERMISSIONS.FINANCE_LOANS_READ]: {
    group: 'finance',
    label: 'مشاهده وام‌ها',
    description: 'مشاهده وام و بدهی‌های تأمین مالی',
  },
  [PERMISSIONS.FINANCE_LOANS_MANAGE]: {
    group: 'finance',
    label: 'مدیریت وام‌ها',
    description: 'ثبت وام و بازپرداخت',
  },
  [PERMISSIONS.FINANCE_PAYABLES_READ]: {
    group: 'finance',
    label: 'مشاهده بدهی تأمین‌کننده',
    description: 'مشاهده حساب‌های پرداختنی',
  },
  [PERMISSIONS.FINANCE_PAYABLES_MANAGE]: {
    group: 'finance',
    label: 'مدیریت بدهی تأمین‌کننده',
    description: 'مدیریت شناسایی/تعدیل حساب‌های پرداختنی',
  },
  [PERMISSIONS.FINANCE_PAYMENTS_READ]: {
    group: 'finance',
    label: 'مشاهده پرداخت‌ها',
    description: 'مشاهده پرداخت‌ها و دریافت‌های مالی',
  },
  [PERMISSIONS.FINANCE_PAYMENTS_CREATE]: {
    group: 'finance',
    label: 'ثبت پرداخت',
    description: 'ثبت پرداخت/دریافت در برابر تعهدات',
  },
  [PERMISSIONS.FINANCE_EXPENSES_READ]: {
    group: 'finance',
    label: 'مشاهده هزینه‌ها',
    description: 'مشاهده اسناد هزینه',
  },
  [PERMISSIONS.FINANCE_EXPENSES_MANAGE]: {
    group: 'finance',
    label: 'مدیریت هزینه‌ها',
    description: 'ثبت و مدیریت هزینه‌های دوره‌ای',
  },
  [PERMISSIONS.FINANCE_FX_READ]: {
    group: 'finance',
    label: 'مشاهده ارز / FX',
    description: 'مشاهده نرخ‌ها، تبدیل‌ها، موقعیت و ارزش‌گذاری',
  },
  [PERMISSIONS.FINANCE_FX_MANAGE]: {
    group: 'finance',
    label: 'مدیریت ارز / FX',
    description: 'ثبت نرخ، تبدیل ارز، پست و برگشت تبدیل',
  },
  [PERMISSIONS.FINANCE_JOURNALS_READ]: {
    group: 'finance',
    label: 'مشاهده دفتر روزنامه',
    description: 'مشاهده اسناد حسابداری',
  },
  [PERMISSIONS.FINANCE_JOURNALS_POST]: {
    group: 'finance',
    label: 'ثبت سند حسابداری',
    description: 'ثبت و برگشت اسناد حسابداری',
  },
  [PERMISSIONS.FINANCE_AUDIT_READ]: {
    group: 'finance',
    label: 'ممیزی مالی',
    description: 'مشاهده تاریخچه ممیزی دامنه مالی',
  },
  [PERMISSIONS.FINANCE_DASHBOARD_READ]: {
    group: 'finance',
    label: 'داشبورد مالی',
    description: 'مشاهده خلاصه داشبورد مالی',
  },
};

export function presentPermission(key: string): PermissionPresentation {
  const known = KNOWN[key];
  if (known) {
    return { key, ...known };
  }
  return {
    key,
    group: 'other',
    label: key,
    description: 'دسترسی تعریف‌شده در سامانه',
  };
}

export function groupPermissions<T extends { key: string }>(
  items: T[],
): Array<{
  group: PermissionGroupId;
  label: string;
  items: Array<T & { presentation: PermissionPresentation }>;
}> {
  const buckets = new Map<
    PermissionGroupId,
    Array<T & { presentation: PermissionPresentation }>
  >();

  for (const item of items) {
    const presentation = presentPermission(item.key);
    const list = buckets.get(presentation.group) ?? [];
    list.push({ ...item, presentation });
    buckets.set(presentation.group, list);
  }

  const order: PermissionGroupId[] = [
    'company',
    'members',
    'roles',
    'permissions',
    'audit',
    'purchasing',
    'finance',
    'other',
  ];

  return order
    .filter((group) => (buckets.get(group)?.length ?? 0) > 0)
    .map((group) => ({
      group,
      label: PERMISSION_GROUP_LABELS[group],
      items: buckets.get(group)!,
    }));
}

export function samePermissionSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

export type { PermissionKey };
