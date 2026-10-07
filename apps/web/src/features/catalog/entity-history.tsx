'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { fetchAuditLogs } from '@/lib/api/hector';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { auditEntityPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { AuditListItem } from '@/types/api';

const ACTION_LABELS: Record<string, string> = {
  PRODUCT_CREATED: 'ایجاد محصول',
  PRODUCT_UPDATED: 'ویرایش محصول',
  PRODUCT_ACTIVATED: 'فعال‌سازی محصول',
  PRODUCT_DEACTIVATED: 'غیرفعال‌سازی محصول',
  PRODUCT_ARCHIVED: 'بایگانی محصول',
  PRODUCT_ATTRIBUTES_UPDATED: 'تغییر مشخصات محصول',
  SKU_CREATED: 'ایجاد SKU',
  SKU_UPDATED: 'ویرایش SKU',
  SKU_ACTIVATED: 'فعال‌سازی SKU',
  SKU_DEACTIVATED: 'غیرفعال‌سازی SKU',
  SKU_ARCHIVED: 'بایگانی SKU',
  SKU_ATTRIBUTES_UPDATED: 'تغییر مشخصات SKU',
  BARCODE_CREATED: 'ایجاد بارکد',
  BARCODE_INTERNAL_GENERATED: 'تولید بارکد داخلی',
  BARCODE_PRIMARY_CHANGED: 'تغییر بارکد اصلی',
  BARCODE_ARCHIVED: 'بایگانی بارکد',
  BRAND_CREATED: 'ایجاد برند',
  BRAND_UPDATED: 'ویرایش برند',
  BRAND_ARCHIVED: 'بایگانی برند',
  BRAND_ACTIVATED: 'فعال‌سازی برند',
  CATEGORY_CREATED: 'ایجاد دسته',
  CATEGORY_UPDATED: 'ویرایش دسته',
  CATEGORY_MOVED: 'جابه‌جایی دسته',
  CATEGORY_ARCHIVED: 'بایگانی دسته',
  CATEGORY_ACTIVATED: 'فعال‌سازی دسته',
  CATALOG_BULK_EXECUTED: 'عملیات گروهی',
  SUPPLIER_CREATED: 'ایجاد تأمین‌کننده',
  SUPPLIER_UPDATED: 'ویرایش تأمین‌کننده',
  SUPPLIER_ACTIVATED: 'فعال‌سازی تأمین‌کننده',
  SUPPLIER_DEACTIVATED: 'غیرفعال‌سازی تأمین‌کننده',
  SUPPLIER_ARCHIVED: 'بایگانی تأمین‌کننده',
  SUPPLIER_CONTACT_CREATED: 'افزودن مخاطب',
  SUPPLIER_CONTACT_UPDATED: 'ویرایش مخاطب',
  SUPPLIER_CONTACT_PRIMARY_CHANGED: 'تغییر مخاطب اصلی',
  SUPPLIER_CONTACT_ARCHIVED: 'بایگانی مخاطب',
  SUPPLIER_NOTE_CREATED: 'ثبت یادداشت',
  SUPPLIER_OFFER_CREATED: 'ثبت استعلام قیمت',
  SUPPLIER_OFFER_UPDATED: 'اصلاح استعلام قیمت',
  SUPPLIER_OFFER_ARCHIVED: 'بایگانی استعلام قیمت',
  PURCHASE_ORDER_CREATED: 'ایجاد سفارش خرید',
  PURCHASE_ORDER_UPDATED: 'ویرایش پیش‌نویس خرید',
  PURCHASE_ORDER_ITEM_ADDED: 'افزودن قلم خرید',
  PURCHASE_ORDER_ITEM_UPDATED: 'ویرایش قلم خرید',
  PURCHASE_ORDER_ITEM_REMOVED: 'حذف قلم خرید',
  PURCHASE_ORDER_APPROVED: 'تأیید خرید',
  PURCHASE_ORDER_ORDERED: 'ثبت سفارش نزد تأمین‌کننده',
  PURCHASE_ORDER_CANCELLED: 'لغو خرید',
  PURCHASE_COST_CREATED: 'ثبت هزینه خرید',
  PURCHASE_COST_UPDATED: 'ویرایش هزینه خرید',
  PURCHASE_COST_VOIDED: 'ابطال هزینه خرید',
  PURCHASE_COST_REMOVED: 'حذف هزینه خرید',
  PURCHASE_ORDER_CORRECTED: 'اصلاح خرید',
  PURCHASE_DUE_DATE_CHANGED: 'تغییر سررسید',
  PURCHASE_FX_TERMS_CHANGED: 'اصلاح شرایط ارزی',
  PURCHASE_DISCREPANCY_RECORDED: 'ثبت مغایرت',
  PURCHASE_DISCREPANCY_RESOLVED: 'بستن مغایرت',
  PURCHASE_ORDER_SHORT_CLOSED: 'بستن جزئی / کسری',
  PURCHASE_RETURN_CREATED: 'ایجاد برگشت خرید',
  PURCHASE_RETURN_UPDATED: 'ویرایش برگشت خرید',
  PURCHASE_RETURN_APPROVED: 'تأیید برگشت خرید',
  PARTY_CREATED: 'ایجاد شخص',
  PARTY_UPDATED: 'ویرایش هویت شخص',
  PARTY_ACTIVATED: 'فعال‌سازی شخص',
  PARTY_DEACTIVATED: 'غیرفعال‌سازی شخص',
  PARTY_ARCHIVED: 'بایگانی شخص',
  PARTY_CONTACT_CREATED: 'افزودن تماس شخص',
  PARTY_CONTACT_UPDATED: 'ویرایش تماس شخص',
  PARTY_CONTACT_DEACTIVATED: 'غیرفعال‌سازی تماس شخص',
  PARTY_CONTACT_PRIMARY_CHANGED: 'تغییر تماس اصلی شخص',
  PARTY_ADDRESS_CREATED: 'افزودن آدرس شخص',
  PARTY_ADDRESS_UPDATED: 'ویرایش آدرس شخص',
  PARTY_ADDRESS_ARCHIVED: 'بایگانی آدرس شخص',
  PARTY_ADDRESS_PRIMARY_CHANGED: 'تغییر آدرس اصلی شخص',
  PARTY_ROLE_ADDED: 'افزودن نقش شخص',
  PARTY_ROLE_DEACTIVATED: 'غیرفعال‌سازی نقش شخص',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'نام',
  code: 'کد',
  description: 'توضیحات',
  brand: 'برند',
  brandId: 'برند',
  brandLabel: 'برند',
  category: 'دسته',
  categoryId: 'دسته',
  categoryLabel: 'دسته',
  status: 'وضعیت',
  archivedAt: 'بایگانی',
  skuCode: 'کد SKU',
  productId: 'محصول',
  value: 'مقدار',
  isPrimary: 'اصلی',
  parentId: 'والد',
  legalName: 'نام حقوقی',
  phone: 'تلفن',
  email: 'ایمیل',
  address: 'آدرس',
  role: 'نقش',
  mobile: 'موبایل',
  body: 'متن',
  quantity: 'تعداد',
  unitPrice: 'قیمت واحد',
  lineSubtotal: 'جمع قلم',
  subtotal: 'جمع کالا',
  total: 'جمع',
  currency: 'ارز',
  purchaseType: 'نوع خرید',
  paymentTermType: 'نوع اعتبار',
  netDays: 'روز اعتبار',
  dueDate: 'سررسید',
  obligationAmount: 'تعهد ارزی',
  obligationCurrency: 'ارز تعهد',
  referenceFxRate: 'نرخ مرجع',
  cancellationReason: 'دلیل لغو',
  amount: 'مبلغ',
  type: 'نوع',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال',
  ARCHIVED: 'بایگانی',
  DRAFT: 'پیش‌نویس',
  APPROVED: 'تأیید شده',
  ORDERED: 'سفارش داده‌شده',
  PARTIALLY_RECEIVED: 'بخشی دریافت‌شده',
  RECEIVED: 'دریافت‌شده',
  CANCELLED: 'لغو شده',
};

const SKIP_FIELDS = new Set(['id', 'normalizedName', 'normalizedCode', 'updatedAt', 'createdAt']);

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function actorLabel(item: AuditListItem): string {
  return item.actor.displayName ?? item.actor.email ?? 'سیستم';
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.label === 'string' && record.label) return record.label;
    if (typeof record.name === 'string' && record.name) return record.name;
    if (typeof record.id === 'string') return record.id;
    return JSON.stringify(value);
  }
  if (typeof value === 'string' && STATUS_LABELS[value]) return STATUS_LABELS[value];
  return String(value);
}

function fieldDiffs(before: unknown, after: unknown): Array<{ label: string; from: string; to: string }> {
  if (!before && !after) return [];
  if (!before || typeof before !== 'object' || Array.isArray(before)) {
    if (!after || typeof after !== 'object' || Array.isArray(after)) return [];
    return Object.entries(after as Record<string, unknown>)
      .filter(([key]) => !SKIP_FIELDS.has(key) && !key.endsWith('Label'))
      .map(([key, value]) => ({
        label: FIELD_LABELS[key] ?? key,
        from: '—',
        to: formatScalar(value),
      }));
  }
  if (!after || typeof after !== 'object' || Array.isArray(after)) {
    return Object.entries(before as Record<string, unknown>)
      .filter(([key]) => !SKIP_FIELDS.has(key) && !key.endsWith('Label'))
      .map(([key, value]) => ({
        label: FIELD_LABELS[key] ?? key,
        from: formatScalar(value),
        to: '—',
      }));
  }

  const beforeObj = before as Record<string, unknown>;
  const afterObj = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const diffs: Array<{ label: string; from: string; to: string }> = [];

  for (const key of keys) {
    if (SKIP_FIELDS.has(key) || key.endsWith('Label')) continue;
    // Prefer structured brand/category objects over bare ids when both exist.
    if ((key === 'brandId' && (beforeObj.brand || afterObj.brand)) ||
        (key === 'categoryId' && (beforeObj.category || afterObj.category))) {
      continue;
    }
    const from = beforeObj[key];
    const to = afterObj[key];
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    diffs.push({
      label: FIELD_LABELS[key] ?? key,
      from: formatScalar(from),
      to: formatScalar(to),
    });
  }
  return diffs;
}

export type EntityHistoryProps = {
  entityType: string;
  entityId: string;
  pageSize?: number;
};

/**
 * Lightweight entity history panel. Requires `audit.read`.
 * Backend remains authority; this only formats list rows.
 */
export function EntityHistory({ entityType, entityId, pageSize = 10 }: EntityHistoryProps) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const [page, setPage] = React.useState(1);

  const query = useQuery({
    queryKey: ['entity-history', companyId, entityType, entityId, page, pageSize],
    enabled: Boolean(companyId) && can(PERMISSIONS.AUDIT_READ),
    queryFn: () =>
      fetchAuditLogs(companyId, {
        page,
        pageSize,
        entityType,
        entityId,
      }),
  });

  if (!can(PERMISSIONS.AUDIT_READ)) {
    return (
      <p className="text-sm text-slate-500">
        برای مشاهده تاریخچه به مجوز ممیزی نیاز دارید.
      </p>
    );
  }

  if (query.isLoading) return <TableSkeleton rows={4} />;
  if (query.isError) {
    return (
      <ErrorState
        title="خطا در دریافت تاریخچه"
        message="بارگذاری تاریخچه تغییرات انجام نشد."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const totalPages = meta?.totalPages ?? 1;

  if (rows.length === 0) {
    return <EmptyState title="هنوز تغییری ثبت نشده است." />;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {rows.map((item) => {
          const diffs = fieldDiffs(item.before, item.after);
          return (
            <li key={item.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{actionLabel(item.action)}</div>
                  <div className="mt-0.5 text-slate-600">
                    {actorLabel(item)} · {formatDateTime(item.createdAt)}
                  </div>
                  {diffs.length > 0 ? (
                    <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                      {diffs.slice(0, 6).map((diff) => (
                        <li key={diff.label}>
                          <span className="font-medium text-slate-700">{diff.label}:</span>{' '}
                          {diff.from} → {diff.to}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                {item.bulkOperationId || item.action === 'CATALOG_BULK_EXECUTED' ? (
                  <Badge>عملیات گروهی</Badge>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={auditEntityPath(entityType, entityId)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          مشاهده همه در تاریخچه
        </Link>
        {totalPages > 1 ? (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              قبلی
            </Button>
            <span className="self-center text-xs text-slate-500">
              {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              بعدی
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
