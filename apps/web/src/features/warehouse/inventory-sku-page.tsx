'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { ClassificationChangeDialog } from '@/features/warehouse/classification-change-dialog';
import { stockClassificationLabel } from '@/features/warehouse/stock-issue-labels';
import { fetchInventorySkuSummary } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { warehouseKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import {
  ROUTES,
  warehouseBatchPath,
  warehouseInventoryPositionMovementsPath,
  warehouseIssueNewPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { StockClassification } from '@/types/stock-classification';

type ReclassTarget = {
  warehouseId: string;
  warehouseCode: string;
  locationId: string;
  locationCode: string;
  batchId: string;
  batchNumber: string;
  fromClassification: StockClassification;
  sourceOnHand: number;
  initialTo?: StockClassification;
};

export function InventorySkuPageClient({ skuId }: { skuId: string }) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canReclass = can(PERMISSIONS.WAREHOUSE_CLASSIFICATION_CHANGE);
  const canIssueCreate = can(PERMISSIONS.WAREHOUSE_ISSUE_CREATE);

  const [reclass, setReclass] = React.useState<ReclassTarget | null>(null);

  const query = useQuery({
    queryKey: warehouseKeys.inventory.sku(companyId, skuId),
    enabled: Boolean(companyId) && Boolean(skuId) && can(PERMISSIONS.WAREHOUSE_STOCK_READ),
    queryFn: () => fetchInventorySkuSummary(companyId, skuId),
  });

  if (!can(PERMISSIONS.WAREHOUSE_STOCK_READ)) return <AccessDenied />;

  const data = query.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={data ? data.skuCode : 'موجودی SKU'}
        description={
          data
            ? `${data.productName ?? '—'} · مجموع موجودی فیزیکی (On Hand): ${data.totalOnHand}`
            : 'تفکیک موجودی فیزیکی بر اساس انبار، بچ و مکان'
        }
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'موجودی فیزیکی', href: ROUTES.warehouseInventory },
          { label: data?.skuCode ?? 'SKU' },
        ]}
        actions={
          <Link
            href={ROUTES.warehouseInventory}
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            بازگشت به موجودی
          </Link>
        }
      />

      {query.isPending ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState message={mapBusinessError(query.error)} onRetry={() => query.refetch()} />
      ) : !data ? (
        <EmptyState title="SKU یافت نشد." />
      ) : (
        <>
          {data.skuStatus === 'ARCHIVED' ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              این SKU آرشیو شده است؛ موجودی فیزیکی همچنان نمایش داده می‌شود.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-600">On Hand (کل)</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">
                {data.totalOnHand}
              </div>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
              <div className="text-sm text-slate-600">Sellable</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">
                {data.sellableOnHand ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
              <div className="text-sm text-slate-600">Reserved</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">
                {data.reservedQuantity ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-4">
              <div className="text-sm text-slate-600">Available</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">
                {data.availableQuantity ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-600">Tester</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">
                {data.testerOnHand ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-600">Damaged</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">
                {data.damagedOnHand ?? 0}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-sm text-slate-600">Quarantine</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums" dir="ltr">
                {data.quarantineOnHand ?? 0}
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Available = Sellable On Hand − Active Reserved. رزرو On Hand را کم نمی‌کند.
          </p>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">موقعیت‌های طبقه‌بندی‌شده</h2>
            {data.positions.length === 0 ? (
              <EmptyState title="موقعیت موجودی برای این SKU وجود ندارد." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">انبار / مکان</th>
                      <th className="px-3 py-2 text-start font-medium">بچ</th>
                      <th className="px-3 py-2 text-start font-medium">طبقه‌بندی</th>
                      <th className="px-3 py-2 text-start font-medium">On Hand</th>
                      <th className="px-3 py-2 text-start font-medium">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((pos) => (
                      <tr
                        key={`${pos.warehouseId}:${pos.locationId}:${pos.batchId}:${pos.classification}`}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs" dir="ltr">
                            {pos.warehouseCode} / {pos.locationCode}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={warehouseBatchPath(pos.batchId)}
                            className="font-mono text-xs underline-offset-2 hover:underline"
                            dir="ltr"
                          >
                            {pos.batchNumber}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {stockClassificationLabel(pos.classification)}
                        </td>
                        <td className="px-3 py-2 tabular-nums" dir="ltr">
                          {pos.onHandQuantity}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={warehouseInventoryPositionMovementsPath({
                                skuId: data.skuId,
                                batchId: pos.batchId,
                                warehouseId: pos.warehouseId,
                                locationId: pos.locationId,
                              })}
                              className="text-xs text-slate-600 underline-offset-2 hover:underline"
                            >
                              حرکات
                            </Link>
                            {canReclass && pos.onHandQuantity > 0 ? (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setReclass({
                                      warehouseId: pos.warehouseId,
                                      warehouseCode: pos.warehouseCode,
                                      locationId: pos.locationId,
                                      locationCode: pos.locationCode,
                                      batchId: pos.batchId,
                                      batchNumber: pos.batchNumber,
                                      fromClassification: pos.classification,
                                      sourceOnHand: pos.onHandQuantity,
                                    })
                                  }
                                >
                                  تغییر طبقه‌بندی
                                </Button>
                                {pos.classification === 'SELLABLE' ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setReclass({
                                        warehouseId: pos.warehouseId,
                                        warehouseCode: pos.warehouseCode,
                                        locationId: pos.locationId,
                                        locationCode: pos.locationCode,
                                        batchId: pos.batchId,
                                        batchNumber: pos.batchNumber,
                                        fromClassification: 'SELLABLE',
                                        sourceOnHand: pos.onHandQuantity,
                                        initialTo: 'TESTER',
                                      })
                                    }
                                  >
                                    تبدیل به تستر
                                  </Button>
                                ) : null}
                                {pos.classification !== 'DAMAGED' ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setReclass({
                                        warehouseId: pos.warehouseId,
                                        warehouseCode: pos.warehouseCode,
                                        locationId: pos.locationId,
                                        locationCode: pos.locationCode,
                                        batchId: pos.batchId,
                                        batchNumber: pos.batchNumber,
                                        fromClassification: pos.classification,
                                        sourceOnHand: pos.onHandQuantity,
                                        initialTo: 'DAMAGED',
                                      })
                                    }
                                  >
                                    علامت آسیب‌دیده
                                  </Button>
                                ) : null}
                                {pos.classification !== 'QUARANTINE' ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setReclass({
                                        warehouseId: pos.warehouseId,
                                        warehouseCode: pos.warehouseCode,
                                        locationId: pos.locationId,
                                        locationCode: pos.locationCode,
                                        batchId: pos.batchId,
                                        batchNumber: pos.batchNumber,
                                        fromClassification: pos.classification,
                                        sourceOnHand: pos.onHandQuantity,
                                        initialTo: 'QUARANTINE',
                                      })
                                    }
                                  >
                                    قرنطینه
                                  </Button>
                                ) : null}
                              </>
                            ) : null}
                            {canIssueCreate &&
                            pos.classification === 'DAMAGED' &&
                            pos.onHandQuantity > 0 ? (
                              <Link
                                href={warehouseIssueNewPath({
                                  reason: 'DAMAGE',
                                  classification: 'DAMAGED',
                                  warehouseId: pos.warehouseId,
                                  locationId: pos.locationId,
                                  skuId: data.skuId,
                                  batchId: pos.batchId,
                                })}
                                className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}
                              >
                                امحای آسیب‌دیده
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {reclass && data ? (
        <ClassificationChangeDialog
          open={Boolean(reclass)}
          onOpenChange={(open) => {
            if (!open) setReclass(null);
          }}
          companyId={companyId}
          warehouseId={reclass.warehouseId}
          warehouseCode={reclass.warehouseCode}
          locationId={reclass.locationId}
          locationCode={reclass.locationCode}
          skuId={data.skuId}
          skuCode={data.skuCode}
          batchId={reclass.batchId}
          batchNumber={reclass.batchNumber}
          fromClassification={reclass.fromClassification}
          sourceOnHand={reclass.sourceOnHand}
          companyTotal={data.totalOnHand}
          initialTo={reclass.initialTo}
        />
      ) : null}
    </div>
  );
}
