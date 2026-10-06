'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import {
  batchExpiryBadgeClass,
  batchExpiryStateLabel,
  formatBatchDateOnly,
} from '@/features/warehouse/batch-labels';
import { goodsReceiptStatusLabel } from '@/features/warehouse/goods-receipt-labels';
import { fetchBatch } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import {
  ROUTES,
  purchasingOrderPath,
  purchasingSupplierPath,
  warehouseGoodsReceiptPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function BatchDetailPageClient({ batchId }: { batchId: string }) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const query = useQuery({
    queryKey: warehouseKeys.batches.detail(companyId, batchId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_BATCH_READ),
    queryFn: () => fetchBatch(companyId, batchId),
  });

  if (!can(PERMISSIONS.WAREHOUSE_BATCH_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError || !query.data) {
    return (
      <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
    );
  }

  const row = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={row.batchNumber}
        description="جزئیات بچ / سری ساخت"
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'بچ / سری ساخت', href: ROUTES.warehouseBatches },
          { label: row.batchNumber },
        ]}
      />

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        «مجموع دریافت» جمع تخصیص‌های این بچ روی رسیدهای ثبت نهایی است — موجودی فعلی انبار یا
        موجودی قابل فروش نیست.
      </p>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <div className="text-xs text-slate-500">بچ داخلی</div>
          <div className="mt-1 font-mono text-sm" dir="ltr">
            {row.batchNumber}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">سری سازنده</div>
          <div className="mt-1 font-mono text-sm" dir="ltr">
            {row.supplierBatchNumber ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">SKU</div>
          <div className="mt-1 font-mono text-sm" dir="ltr">
            {row.skuCode}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">محصول</div>
          <div className="mt-1 text-sm">{row.productName ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">تاریخ تولید</div>
          <div className="mt-1 text-sm" dir="ltr">
            {formatBatchDateOnly(row.manufacturedAt)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">تاریخ انقضا</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge className={batchExpiryBadgeClass(row.expiryState)}>
              {batchExpiryStateLabel(row.expiryState)}
            </Badge>
            <span className="text-sm" dir="ltr">
              {formatBatchDateOnly(row.expiresAt)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">مجموع دریافت (رسید ثبت‌شده)</div>
          <div className="mt-1 text-lg font-semibold tabular-nums" dir="ltr">
            {row.totalReceived}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">اولین / آخرین دریافت</div>
          <div className="mt-1 text-sm">
            {row.firstReceivedAt ? formatDateTime(row.firstReceivedAt) : '—'}
            {' · '}
            {row.lastReceivedAt ? formatDateTime(row.lastReceivedAt) : '—'}
          </div>
        </div>
        {row.notes ? (
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500">یادداشت</div>
            <div className="mt-1 whitespace-pre-wrap text-sm">{row.notes}</div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">سابقه دریافت (رسید ثبت‌شده)</h2>
        {row.receipts.length === 0 ? (
          <p className="text-sm text-slate-500">
            هنوز تخصیصی روی رسید ثبت نهایی برای این بچ ثبت نشده است.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 text-start font-medium">رسید</th>
                  <th className="py-1 text-start font-medium">تعداد</th>
                  <th className="py-1 text-start font-medium">سفارش خرید</th>
                  <th className="py-1 text-start font-medium">تأمین‌کننده</th>
                  <th className="py-1 text-start font-medium">ثبت نهایی</th>
                </tr>
              </thead>
              <tbody>
                {row.receipts.map((r) => (
                  <tr key={`${r.goodsReceiptItemId}-${r.goodsReceiptId}`} className="border-t border-slate-100">
                    <td className="py-2">
                      <Link
                        href={warehouseGoodsReceiptPath(r.goodsReceiptId)}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        {r.goodsReceiptNumber}
                      </Link>
                      <div className="mt-0.5">
                        <Badge>{goodsReceiptStatusLabel(r.goodsReceiptStatus as 'DRAFT' | 'POSTED' | 'CANCELLED')}</Badge>
                      </div>
                    </td>
                    <td className="py-2 tabular-nums" dir="ltr">
                      {r.quantity}
                    </td>
                    <td className="py-2">
                      <Link
                        href={purchasingOrderPath(r.purchaseOrderId)}
                        className="underline-offset-2 hover:underline"
                      >
                        {r.purchaseOrderNumber}
                      </Link>
                    </td>
                    <td className="py-2">
                      <Link
                        href={purchasingSupplierPath(r.supplierId)}
                        className="underline-offset-2 hover:underline"
                      >
                        {r.supplierName}
                      </Link>
                    </td>
                    <td className="py-2 text-slate-600">
                      {r.postedAt ? formatDateTime(r.postedAt) : '—'}
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
