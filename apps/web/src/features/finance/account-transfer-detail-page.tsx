'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AccessDenied,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { fetchAccountTransfer } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeTransferKeys } from '@/lib/query/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function AccountTransferDetailPageClient({ transferId }: { transferId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_TRANSFERS_READ);

  const detailQuery = useQuery({
    queryKey: financeTransferKeys.detail(companyId, transferId),
    queryFn: () => fetchAccountTransfer(companyId, transferId),
    enabled: Boolean(companyId) && canRead,
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isError) {
    if (isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
    return (
      <ErrorState message="بارگذاری انتقال ناموفق بود." onRetry={() => detailQuery.refetch()} />
    );
  }
  if (detailQuery.isLoading || !detailQuery.data) return <TableSkeleton rows={4} />;

  const row = detailQuery.data;
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={row.number}
        description="انتقال هم‌ارز — ACCOUNT_TRANSFER (خروج + ورود)"
        actions={
          <Link
            href={ROUTES.financeAccountTransfers}
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            بازگشت
          </Link>
        }
      />
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">وضعیت</dt>
          <dd>
            <Badge>{row.status}</Badge>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">مبلغ</dt>
          <dd className="tabular-nums">
            {row.amount} {row.currency}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">از حساب</dt>
          <dd>
            {row.sourceAccount.code} — {row.sourceAccount.name}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">به حساب</dt>
          <dd>
            {row.destinationAccount.code} — {row.destinationAccount.name}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">یادداشت</dt>
          <dd>{row.notes ?? '—'}</dd>
        </div>
      </dl>
    </div>
  );
}
