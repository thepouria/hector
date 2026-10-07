'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  channelSettlementStatusLabel,
  formatSettlementMoney,
  statusBadgeClass,
} from '@/features/settlement/settlement-labels';
import { fetchChannelSettlements } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, settlementChannelPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

function grossFromComponents(
  components: Array<{ type: string; effect: string; amount: string }>,
): string {
  return components
    .filter((c) => c.type === 'GROSS_SALES')
    .reduce((sum, c) => sum + Number(c.amount || 0), 0)
    .toString();
}

export function ChannelSettlementsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_SETTLEMENTS_READ);
  const canManage = can(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE);

  const status = searchParams.get('status') ?? '';
  const outstandingOnly = searchParams.get('outstandingOnly') ?? '';
  const filters = {
    page: 1,
    pageSize: 50,
    ...(status ? { status } : {}),
    ...(outstandingOnly ? { outstandingOnly } : {}),
  };

  const listQuery = useQuery({
    queryKey: settlementKeys.channels(companyId, filters),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchChannelSettlements(companyId, filters),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  if (!canRead) return <AccessDenied />;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="تسویه کانال"
        description="صورتحساب دستی کانال‌های فروش — Expected Net از اجزا مشتق می‌شود، نه از مبلغ بانک."
        actions={
          canManage ? (
            <Link href={ROUTES.settlementChannelNew} className={cn(buttonVariants())}>
              تسویه جدید
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-4">
        <div>
          <Label htmlFor="status">وضعیت</Label>
          <select
            id="status"
            className="mt-1 block rounded-md border px-3 py-2 text-sm"
            value={status}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams.toString());
              if (!e.target.value) params.delete('status');
              else params.set('status', e.target.value);
              router.replace(`${pathname}?${params.toString()}`);
            }}
          >
            <option value="">همه</option>
            <option value="DRAFT">پیش‌نویس</option>
            <option value="OPEN">باز</option>
            <option value="PARTIALLY_RECEIVED">دریافت جزئی</option>
            <option value="RECEIVED">دریافت کامل</option>
          </select>
        </div>
      </div>

      {listQuery.isLoading ? (
        <TableSkeleton rows={6} />
      ) : listQuery.isError ? (
        <ErrorState message="بارگذاری تسویه کانال ناموفق بود." onRetry={() => listQuery.refetch()} />
      ) : !listQuery.data?.data.length ? (
        <EmptyState
          title="تسویه کانالی نیست"
          description="هنوز صورتحساب بازارگاه / کانال ثبت نشده است."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b text-right text-muted-foreground">
                <th className="px-3 py-2 font-medium">شماره</th>
                <th className="px-3 py-2 font-medium">کانال</th>
                <th className="px-3 py-2 font-medium">دوره</th>
                <th className="px-3 py-2 font-medium">ناخالص</th>
                <th className="px-3 py-2 font-medium">Expected Net</th>
                <th className="px-3 py-2 font-medium">دریافت‌شده</th>
                <th className="px-3 py-2 font-medium">مانده</th>
                <th className="px-3 py-2 font-medium">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-3 py-3">
                    <Link
                      href={settlementChannelPath(row.id)}
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {row.number}
                    </Link>
                  </td>
                  <td className="px-3 py-3">{row.channel?.code ?? row.channelId}</td>
                  <td className="px-3 py-3 text-xs">
                    {formatDateTime(row.periodStart)} — {formatDateTime(row.periodEnd)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatSettlementMoney(grossFromComponents(row.components), row.currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatSettlementMoney(row.expectedNet, row.currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {formatSettlementMoney(row.actualReceived ?? row.actualReceivedAmount ?? '0', row.currency)}
                  </td>
                  <td className="px-3 py-3 tabular-nums font-medium">
                    {formatSettlementMoney(row.outstandingAmount, row.currency)}
                  </td>
                  <td className="px-3 py-3">
                    <Badge className={statusBadgeClass(row.status)}>
                      {channelSettlementStatusLabel(row.status)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
