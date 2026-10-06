'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { formatBatchDateOnly } from '@/features/warehouse/batch-labels';
import {
  formatInventoryQuantityDelta,
  inventoryMovementTypeLabel,
  inventorySourceTypeLabel,
} from '@/features/warehouse/inventory-labels';
import { fetchInventoryMovement } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import {
  ROUTES,
  warehouseBatchPath,
  warehouseInventoryMovementPath,
  warehousePutawayPath,
  warehouseTransferPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { InventorySourceType } from '@/types/inventory';

function sourceDetailHref(sourceType: InventorySourceType, sourceId: string): string | null {
  if (sourceType === 'PUTAWAY') return warehousePutawayPath(sourceId);
  if (sourceType === 'TRANSFER') return warehouseTransferPath(sourceId);
  return null;
}

export function InventoryMovementDetailPageClient({ movementId }: { movementId: string }) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const query = useQuery({
    queryKey: warehouseKeys.inventory.movements.detail(companyId, movementId),
    enabled: Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_STOCK_READ),
    queryFn: () => fetchInventoryMovement(companyId, movementId),
  });

  if (!can(PERMISSIONS.WAREHOUSE_STOCK_READ)) return <AccessDenied />;
  if (query.isPending) return <PageSkeleton />;
  if (query.isError || !query.data) {
    return (
      <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
    );
  }

  const row = query.data;
  const deltaText = formatInventoryQuantityDelta(row.quantityDelta);
  const sourceHref = sourceDetailHref(row.sourceType, row.sourceId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="جزئیات حرکت انبار"
        description="ردیف دفتر حرکات — فقط مشاهده."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'موجودی', href: ROUTES.warehouseInventory },
          { label: 'حرکات انبار', href: ROUTES.warehouseInventoryMovements },
          { label: deltaText },
        ]}
      />

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
        حرکات ثبت‌شده در دفتر موجودی غیرقابل ویرایش یا حذف هستند. «تغییر تعداد» با علامت مثبت یا
        منفی نشان داده می‌شود — نه موجودی رزرو یا قابل فروش.
      </p>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <div className="text-xs text-slate-500">زمان وقوع</div>
          <div className="mt-1">{formatDateTime(row.occurredAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">زمان ثبت</div>
          <div className="mt-1">{formatDateTime(row.createdAt)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">نوع حرکت</div>
          <div className="mt-1">
            <Badge>{inventoryMovementTypeLabel(row.movementType)}</Badge>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">تغییر تعداد</div>
          <div className="mt-1 font-semibold tabular-nums text-slate-900" dir="ltr">
            {deltaText}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">انبار</div>
          <div className="mt-1 font-mono text-sm" dir="ltr">
            {row.warehouseCode}
          </div>
          <div>{row.warehouseName}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">مکان</div>
          <div className="mt-1 font-mono text-sm" dir="ltr">
            {row.locationCode}
          </div>
          {row.locationName ? <div>{row.locationName}</div> : null}
          <div className="text-xs text-slate-500" dir="ltr">
            {row.locationBarcode}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">SKU</div>
          <div className="mt-1 font-mono text-sm" dir="ltr">
            {row.skuCode}
          </div>
          <div>{row.productName ?? '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">بچ</div>
          <div className="mt-1">
            <Link
              href={warehouseBatchPath(row.batchId)}
              className="font-mono text-sm underline-offset-2 hover:underline"
              dir="ltr"
            >
              {row.batchNumber}
            </Link>
          </div>
          {row.supplierBatchNumber ? (
            <div className="text-xs text-slate-500" dir="ltr">
              سری سازنده: {row.supplierBatchNumber}
            </div>
          ) : null}
          {row.expiresAt ? (
            <div className="text-xs text-slate-500">
              انقضا: {formatBatchDateOnly(row.expiresAt)}
            </div>
          ) : null}
        </div>
        <div>
          <div className="text-xs text-slate-500">منبع</div>
          <div className="mt-1">{inventorySourceTypeLabel(row.sourceType)}</div>
          {sourceHref ? (
            <Link href={sourceHref} className="text-sm underline-offset-2 hover:underline">
              مشاهدهٔ منبع
            </Link>
          ) : (
            <div className="font-mono text-xs text-slate-600" dir="ltr">
              {row.sourceId}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-500">شناسهٔ خط منبع</div>
          <div className="mt-1 font-mono text-xs" dir="ltr">
            {row.sourceLineId}
          </div>
        </div>
        {row.operationId ? (
          <div>
            <div className="text-xs text-slate-500">شناسهٔ عملیات</div>
            <div className="mt-1 font-mono text-xs" dir="ltr">
              {row.operationId}
            </div>
          </div>
        ) : null}
        {row.reasonCode ? (
          <div>
            <div className="text-xs text-slate-500">کد دلیل</div>
            <div className="mt-1 font-mono text-sm" dir="ltr">
              {row.reasonCode}
            </div>
          </div>
        ) : null}
        {row.reversalOfMovementId ? (
          <div>
            <div className="text-xs text-slate-500">برگشت از حرکت</div>
            <div className="mt-1">
              <Link
                href={warehouseInventoryMovementPath(row.reversalOfMovementId)}
                className="font-mono text-xs underline-offset-2 hover:underline"
                dir="ltr"
              >
                {row.reversalOfMovementId}
              </Link>
            </div>
          </div>
        ) : null}
        <div>
          <div className="text-xs text-slate-500">ثبت‌کننده</div>
          <div className="mt-1">{row.createdBy?.displayName ?? '—'}</div>
        </div>
      </section>

      {row.notes ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">یادداشت</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{row.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
