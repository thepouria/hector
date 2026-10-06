'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import {
  fetchInventoryValuationByClassification,
  fetchInventoryValuationByWarehouse,
  fetchInventoryValuationSummary,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function ValuationPageClient() {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const enabled = Boolean(companyId) && can(PERMISSIONS.WAREHOUSE_VALUATION_READ);

  const summary = useQuery({
    queryKey: ['warehouse', 'valuation', companyId],
    enabled,
    queryFn: () => fetchInventoryValuationSummary(companyId),
  });
  const byWh = useQuery({
    queryKey: ['warehouse', 'valuation', 'by-warehouse', companyId],
    enabled,
    queryFn: () => fetchInventoryValuationByWarehouse(companyId),
  });
  const byClass = useQuery({
    queryKey: ['warehouse', 'valuation', 'by-class', companyId],
    enabled,
    queryFn: () => fetchInventoryValuationByClassification(companyId),
  });

  if (!can(PERMISSIONS.WAREHOUSE_VALUATION_READ)) return <AccessDenied />;

  const loading = summary.isPending || byWh.isPending || byClass.isPending;
  const error = summary.error || byWh.error || byClass.error;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ارزش‌گذاری موجودی"
        description="ارزش مبتنی بر لایه‌های بهای تحصیل باقی‌مانده. سود / COGS محاسبه نمی‌شود. رزرو ارزش مالکیت را کم نمی‌کند."
        breadcrumbs={[
          { label: 'عملیات', href: ROUTES.warehouse },
          { label: 'ارزش‌گذاری موجودی' },
        ]}
      />

      {loading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState
          message={mapBusinessError(error)}
          onRetry={() => {
            void summary.refetch();
            void byWh.refetch();
            void byClass.refetch();
          }}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="ارزش کل (شناخته‌شده)"
              value={summary.data?.totalInventoryValue ?? '0'}
            />
            <Stat label="مقدار ارزش‌گذاری‌شده" value={String(summary.data?.valuedQuantity ?? 0)} />
            <Stat
              label="مقدار جزئی"
              value={String(summary.data?.partiallyValuedQuantity ?? 0)}
            />
            <Stat label="مقدار بدون بها (UNVALUED)" value={String(summary.data?.unvaluedQuantity ?? 0)} />
          </div>
          <p className="text-sm text-slate-600">
            کامل بودن: {summary.data?.valuationCompleteness ?? '—'}
          </p>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">بر اساس انبار</h2>
            <SimpleTable
              headers={['انبار', 'مقدار ارزش‌دار', 'بدون بها', 'ارزش']}
              rows={(byWh.data?.data ?? []).map((r) => [
                r.code,
                String(r.valuedQuantity),
                String(r.unvaluedQuantity),
                r.totalValue,
              ])}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-slate-900">بر اساس طبقه‌بندی</h2>
            <SimpleTable
              headers={['طبقه‌بندی', 'مقدار ارزش‌دار', 'بدون بها', 'ارزش']}
              rows={(byClass.data?.data ?? []).map((r) => [
                r.classification,
                String(r.valuedQuantity),
                String(r.unvaluedQuantity),
                r.totalValue,
              ])}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function SimpleTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-right text-slate-600">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
