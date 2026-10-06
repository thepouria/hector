'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  supplierReturnFulfillmentStatusLabel,
  supplierReturnExecutionStatusLabel,
} from '@/features/warehouse/supplier-return-labels';
import { purchaseReturnReasonLabel } from '@/features/purchasing/purchase-order-labels';
import type { PurchaseReturnResolution } from '@/types/purchasing';

function purchaseReturnResolutionLabel(resolution: PurchaseReturnResolution): string {
  switch (resolution) {
    case 'SUPPLIER_CREDIT':
      return 'بستانکاری تأمین‌کننده';
    case 'REFUND':
      return 'بازپرداخت';
    case 'REPLACEMENT':
      return 'جایگزینی';
    case 'PAYABLE_REDUCTION':
      return 'کاهش بدهی';
    case 'UNKNOWN':
      return 'نامشخص';
    default:
      return resolution;
  }
}
import { fetchWarehouseSupplierReturn } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  purchasingReturnPath,
  warehouseSupplierReturnExecutionNewPath,
  warehouseSupplierReturnExecutionPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function SupplierReturnDetailPageClient({ purchaseReturnId }: { purchaseReturnId: string }) {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_CREATE_EXECUTION);

  const query = useQuery({
    queryKey: warehouseKeys.supplierReturns.detail(companyId, purchaseReturnId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ),
    queryFn: () => fetchWarehouseSupplierReturn(companyId, purchaseReturnId),
  });

  if (!can(PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError) {
    return <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />;
  }
  if (!query.data) return <ErrorState message="برگشت خرید یافت نشد." />;

  const row = query.data;
  const hasRemaining = row.progress.remainingQuantity > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.number}
        description={`${row.supplier.name} · ${purchaseReturnReasonLabel(row.reason)}`}
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'برگشت به تأمین‌کننده', href: ROUTES.warehouseSupplierReturns },
          { label: row.number },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {hasRemaining && canCreate ? (
              <Link
                href={warehouseSupplierReturnExecutionNewPath(purchaseReturnId)}
                className={cn(buttonVariants())}
              >
                اجرای جدید
              </Link>
            ) : null}
            <Link
              href={purchasingReturnPath(purchaseReturnId)}
              className={cn(buttonVariants({ variant: 'outline' }))}
            >
              نمای خرید
            </Link>
            <Link
              href={ROUTES.warehouseSupplierReturns}
              className={cn(buttonVariants({ variant: 'ghost' }))}
            >
              بازگشت
            </Link>
          </div>
        }
      />

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        اطلاعات تجاری (خرید) — فقط خواندنی. خروج فیزیکی از طریق اجراهای انبار (SRE) ثبت می‌شود.
      </div>

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
        <div>
          <div className="text-xs text-slate-500">تأمین‌کننده</div>
          <div className="font-medium">{row.supplier.name}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">سفارش خرید</div>
          <div className="font-mono text-sm" dir="ltr">
            {row.purchaseOrderNumber ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">پیشرفت انبار</div>
          <Badge>{supplierReturnFulfillmentStatusLabel(row.progress.fulfillmentStatus)}</Badge>
        </div>
        <div>
          <div className="text-xs text-slate-500">دلیل</div>
          <div>{purchaseReturnReasonLabel(row.reason)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">انتظار حل</div>
          <div>{purchaseReturnResolutionLabel(row.expectedResolution)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">تأیید</div>
          <div className="text-sm">{row.approvedAt ? formatDateTime(row.approvedAt) : '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">مجاز</div>
          <div className="tabular-nums font-medium" dir="ltr">
            {row.progress.approvedQuantity}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">ارسال‌شده (DISPATCHED)</div>
          <div className="tabular-nums font-medium" dir="ltr">
            {row.progress.dispatchedQuantity}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">مانده</div>
          <div className="tabular-nums font-semibold text-amber-800" dir="ltr">
            {row.progress.remainingQuantity}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">اقلام تجاری</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-start font-medium">SKU</th>
                <th className="px-3 py-2 text-start font-medium">محصول</th>
                <th className="px-3 py-2 text-start font-medium">تعداد مجاز</th>
                <th className="px-3 py-2 text-start font-medium">دلیل</th>
              </tr>
            </thead>
            <tbody>
              {row.items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                    {item.sku.code}
                  </td>
                  <td className="px-3 py-2">{item.sku.product.name}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-2">
                    {item.reason ? purchaseReturnReasonLabel(item.reason) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">اجراهای انبار</h2>
        {row.executions.length === 0 ? (
          <p className="text-sm text-slate-600">هنوز اجرایی ثبت نشده است.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">شماره</th>
                  <th className="px-3 py-2 text-start font-medium">وضعیت</th>
                  <th className="px-3 py-2 text-start font-medium">انبار</th>
                  <th className="px-3 py-2 text-start font-medium">واحد</th>
                  <th className="px-3 py-2 text-start font-medium">ارسال</th>
                </tr>
              </thead>
              <tbody>
                {row.executions.map((ex) => (
                  <tr
                    key={ex.id}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                    onClick={() => router.push(warehouseSupplierReturnExecutionPath(ex.id))}
                  >
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {ex.number}
                    </td>
                    <td className="px-3 py-2">
                      <Badge>{supplierReturnExecutionStatusLabel(ex.status)}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                      {ex.warehouseCode}
                    </td>
                    <td className="px-3 py-2 tabular-nums" dir="ltr">
                      {ex.totalQuantity}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {ex.dispatchedAt ? formatDateTime(ex.dispatchedAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
