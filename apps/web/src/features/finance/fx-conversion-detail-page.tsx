'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AccessDenied,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  fetchFxConversion,
  postFxConversion,
  reverseFxConversion,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeFxKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export function FxConversionDetailPageClient({ conversionId }: { conversionId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_FX_READ);
  const canManage = can(PERMISSIONS.FINANCE_FX_MANAGE);
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: financeFxKeys.conversion(companyId, conversionId),
    queryFn: () => fetchFxConversion(companyId, conversionId),
    enabled: Boolean(companyId) && canRead,
  });

  const postMutation = useMutation({
    mutationFn: () => postFxConversion(companyId, conversionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeFxKeys.all(companyId) });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: () => reverseFxConversion(companyId, conversionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: financeFxKeys.all(companyId) });
    },
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isError) {
    if (isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState message="بارگذاری تبدیل ناموفق بود." onRetry={() => detailQuery.refetch()} />
    );
  }
  if (detailQuery.isLoading || !detailQuery.data) {
    return <TableSkeleton rows={4} />;
  }

  const row = detailQuery.data;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={row.number}
        description={`${row.rateDisplay} — ارز اصلی حفظ می‌شود.`}
      />
      <div className="space-y-2 text-sm">
        <div>
          وضعیت: <Badge>{row.status}</Badge>
        </div>
        <div className="tabular-nums">
          از: {row.fromAmount} {row.fromCurrency} ({row.sourceAccount.code})
        </div>
        <div className="tabular-nums">
          به: {row.toAmount} {row.toCurrency} ({row.destinationAccount.code})
        </div>
        <div className="tabular-nums">نرخ اعمال‌شده: {row.rateDisplay}</div>
      </div>
      {canManage && row.status === 'DRAFT' ? (
        <Button
          onClick={() => postMutation.mutate()}
          disabled={postMutation.isPending}
        >
          پست تبدیل
        </Button>
      ) : null}
      {canManage && row.status === 'POSTED' ? (
        <Button
          variant="outline"
          onClick={() => reverseMutation.mutate()}
          disabled={reverseMutation.isPending}
        >
          برگشت با مبالغ اصلی
        </Button>
      ) : null}
    </div>
  );
}
