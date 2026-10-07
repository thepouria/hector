'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  discrepancyReasonLabel,
  formatSettlementMoney,
  reconciliationStatusLabel,
  resolutionTypeLabel,
  statusBadgeClass,
} from '@/features/settlement/settlement-labels';
import {
  addReconciliationDiscrepancy,
  closeReconciliationMatching,
  fetchReconciliation,
  fetchReconciliationCandidates,
  matchReconciliation,
  moveReconciliationUnderReview,
  resolveReconciliation,
  reverseReconciliationMatch,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { settlementKeys } from '@/lib/query/keys';
import {
  ROUTES,
  settlementChannelPath,
  settlementLoanPath,
  settlementPayablePath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const REASON_CODES = [
  'BANK_FEE',
  'COMMISSION_DIFFERENCE',
  'RETURN_DIFFERENCE',
  'FEE_DIFFERENCE',
  'ROUNDING',
  'TIMING_DIFFERENCE',
  'DUPLICATE_TRANSACTION',
  'MISSING_TRANSACTION',
  'WRONG_AMOUNT',
  'WRONG_REFERENCE',
  'FX_DIFFERENCE',
  'MANUAL_ADJUSTMENT',
  'OTHER',
] as const;

function sourceHref(sourceType: string, sourceId: string): string {
  if (sourceType === 'CHANNEL') return settlementChannelPath(sourceId);
  if (sourceType === 'SUPPLIER_PAYABLE') return settlementPayablePath(sourceId);
  if (sourceType === 'LOAN') return settlementLoanPath(sourceId);
  return ROUTES.settlements;
}

export function ReconciliationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.FINANCE_RECONCILIATION_READ);
  const canMatch = can(PERMISSIONS.FINANCE_RECONCILIATION_MATCH);
  const canReview = can(PERMISSIONS.FINANCE_RECONCILIATION_REVIEW);
  const canResolve = can(PERMISSIONS.FINANCE_RECONCILIATION_RESOLVE);
  const canReverse = can(PERMISSIONS.FINANCE_RECONCILIATION_REVERSE);
  const queryClient = useQueryClient();

  const [candidateOpen, setCandidateOpen] = React.useState(false);
  const [matchTxnId, setMatchTxnId] = React.useState('');
  const [matchAmount, setMatchAmount] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState<string>('BANK_FEE');
  const [reasonAmount, setReasonAmount] = React.useState('');
  const [reasonDesc, setReasonDesc] = React.useState('');
  const [resolutionType, setResolutionType] = React.useState('ACCEPTED_VARIANCE');
  const [resolutionNotes, setResolutionNotes] = React.useState('');
  const [reverseId, setReverseId] = React.useState('');
  const [reverseReason, setReverseReason] = React.useState('');

  const detailQuery = useQuery({
    queryKey: settlementKeys.reconciliation(companyId, id),
    enabled: Boolean(companyId) && canRead && Boolean(id),
    queryFn: () => fetchReconciliation(companyId, id),
  });

  const candidatesQuery = useQuery({
    queryKey: [...settlementKeys.reconciliation(companyId, id), 'candidates'],
    enabled: Boolean(companyId) && canRead && candidateOpen,
    queryFn: () => fetchReconciliationCandidates(companyId, id),
  });

  React.useEffect(() => {
    if (detailQuery.error && isApiClientError(detailQuery.error) && detailQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [detailQuery.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: settlementKeys.reconciliation(companyId, id),
    });
    await queryClient.invalidateQueries({ queryKey: settlementKeys.dashboard(companyId) });
  };

  const matchMut = useMutation({
    mutationFn: () => {
      const row = detailQuery.data!;
      const financeTxnType =
        row.sourceType === 'CHANNEL' || row.sourceType === 'SETTLEMENT'
          ? 'RECEIPT'
          : 'PAYMENT';
      return matchReconciliation(companyId, id, {
        financeTxnType,
        financeTxnId: matchTxnId.trim(),
        amount: matchAmount.trim(),
        requestId: crypto.randomUUID(),
      });
    },
    onSuccess: async () => {
      toast.success('تطبیق ثبت شد');
      setMatchTxnId('');
      setMatchAmount('');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const closeMut = useMutation({
    mutationFn: () => closeReconciliationMatching(companyId, id),
    onSuccess: async () => {
      toast.success('تطبیق بسته شد — اختلاف ارزیابی شد');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const discMut = useMutation({
    mutationFn: () =>
      addReconciliationDiscrepancy(companyId, id, {
        amount: reasonAmount.trim(),
        reasonCode,
        description: reasonDesc || undefined,
      }),
    onSuccess: async () => {
      toast.success('دلیل مغایرت افزوده شد');
      setReasonAmount('');
      setReasonDesc('');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const reviewMut = useMutation({
    mutationFn: () => moveReconciliationUnderReview(companyId, id),
    onSuccess: async () => {
      toast.success('به حالت بررسی منتقل شد');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const resolveMut = useMutation({
    mutationFn: () =>
      resolveReconciliation(companyId, id, {
        resolutionType,
        resolutionNotes: resolutionNotes || undefined,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      toast.success('مغایرت حل شد — اختلاف تاریخی حفظ می‌شود');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const reverseMut = useMutation({
    mutationFn: () =>
      reverseReconciliationMatch(companyId, id, {
        allocationId: reverseId.trim(),
        reason: reverseReason.trim() || 'Wrong match',
      }),
    onSuccess: async () => {
      toast.success('تطبیق برگشت خورد');
      setReverseId('');
      setReverseReason('');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) return <AccessDenied />;
  if (detailQuery.isLoading) return <PageSkeleton />;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <ErrorState message="بارگذاری پرونده ناموفق بود." onRetry={() => detailQuery.refetch()} />
    );
  }

  const row = detailQuery.data;
  const showDiff =
    Boolean(row.matchingClosedAt) ||
    ['DISCREPANCY', 'UNDER_REVIEW', 'RESOLVED', 'MATCHED'].includes(row.status);
  const explained = row.discrepancies.reduce((s, d) => s + Number(d.amount || 0), 0);
  const unexplained = Number(row.differenceAmount || 0) - explained;

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title={row.number}
        description="Expected و Actual تغییر نمی‌کنند؛ فقط مقایسه و توضیح اختلاف."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Badge className={statusBadgeClass(row.status)}>
          {reconciliationStatusLabel(row.status)}
        </Badge>
        <a
          href={sourceHref(row.sourceType, row.sourceId)}
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          منبع: {row.sourceType}
        </a>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 rounded-lg border p-4 text-sm">
        <div>
          <div className="text-muted-foreground">Expected</div>
          <div className="tabular-nums font-semibold">
            {formatSettlementMoney(row.expectedAmount, row.currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Matched</div>
          <div className="tabular-nums font-semibold">
            {formatSettlementMoney(row.matchedAmount, row.currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">مانده Expected</div>
          <div className="tabular-nums">
            {formatSettlementMoney(row.remainingExpected, row.currency)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">اختلاف (matched − expected)</div>
          <div className="tabular-nums font-semibold">
            {showDiff ? formatSettlementMoney(row.differenceAmount, row.currency) : '—'}
          </div>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold">تخصیص‌های فعال</h2>
        {!row.allocations.length ? (
          <EmptyState title="هنوز تطبیقی نیست" description="تراکنش Finance را انتخاب و تخصیص دهید." />
        ) : (
          <ul className="space-y-2 text-sm">
            {row.allocations.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b pb-2">
                <span>
                  {a.financeTxnType} · {a.financeTxnId.slice(0, 8)}…
                </span>
                <span className="tabular-nums">
                  {formatSettlementMoney(a.amount, row.currency)}
                </span>
                <span className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canMatch && !row.matchingClosedAt && row.status !== 'RESOLVED' && row.status !== 'CANCELLED' ? (
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">تطبیق دستی</h2>
            <Button variant="outline" onClick={() => setCandidateOpen((v) => !v)}>
              {candidateOpen ? 'بستن نامزدها' : 'یافتن تراکنش Finance'}
            </Button>
          </div>
          {candidateOpen ? (
            candidatesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">در حال جستجو…</p>
            ) : !candidatesQuery.data?.length ? (
              <EmptyState
                title="نامزدی نیست"
                description="تراکنش هم‌ارز / هم‌جهت با ظرفیت آزاد یافت نشد."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {candidatesQuery.data.map((c) => {
                  const cid = String(c.id ?? c.financeTxnId ?? '');
                  const hints = Array.isArray(c.hints) ? (c.hints as string[]) : [];
                  return (
                    <li key={cid} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
                      <div>
                        <div className="font-medium tabular-nums">
                          {formatSettlementMoney(String(c.amount ?? '0'), String(c.currency ?? row.currency))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          باقیمانده قابل تخصیص:{' '}
                          {String(c.remainingAllocatable ?? c.remainingCapacity ?? '—')}
                        </div>
                        {hints.length ? (
                          <div className="text-xs text-amber-800">{hints.join(' · ')}</div>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMatchTxnId(cid);
                          setMatchAmount(String(c.remainingAllocatable ?? c.amount ?? ''));
                        }}
                      >
                        انتخاب
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>شناسه تراکنش</Label>
              <Input value={matchTxnId} onChange={(e) => setMatchTxnId(e.target.value)} />
            </div>
            <div>
              <Label>مبلغ تخصیص</Label>
              <Input value={matchAmount} onChange={(e) => setMatchAmount(e.target.value)} />
              {matchAmount ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  پس از تطبیق تقریباً{' '}
                  {formatSettlementMoney(
                    String(Math.max(0, Number(row.remainingExpected) - Number(matchAmount || 0))),
                    row.currency,
                  )}{' '}
                  باقی می‌ماند (پیش‌نمایش).
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!matchTxnId || !matchAmount || matchMut.isPending}
              onClick={() => matchMut.mutate()}
            >
              تأیید تطبیق
            </Button>
            <Button
              variant="outline"
              disabled={closeMut.isPending}
              onClick={() => closeMut.mutate()}
            >
              بستن تطبیق / ارزیابی اختلاف
            </Button>
          </div>
        </section>
      ) : null}

      {canReverse ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">برگشت تطبیق نادرست</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>شناسه Allocation</Label>
              <Input value={reverseId} onChange={(e) => setReverseId(e.target.value)} />
            </div>
            <div>
              <Label>دلیل</Label>
              <Input value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
            </div>
          </div>
          <Button
            variant="danger"
            disabled={!reverseId || reverseMut.isPending}
            onClick={() => reverseMut.mutate()}
          >
            برگشت تخصیص
          </Button>
        </section>
      ) : null}

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">دلایل مغایرت</h2>
        {row.discrepancies.length ? (
          <ul className="space-y-2 text-sm">
            {row.discrepancies.map((d) => (
              <li key={d.id} className="flex justify-between gap-3">
                <span>
                  {discrepancyReasonLabel(d.reasonCode)}
                  {d.description ? (
                    <span className="text-muted-foreground"> — {d.description}</span>
                  ) : null}
                </span>
                <span className="tabular-nums">
                  {formatSettlementMoney(d.amount, d.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">دلیلی ثبت نشده.</p>
        )}
        {showDiff ? (
          <p className="text-xs text-muted-foreground">
            توضیح‌داده‌شده: {explained} · توضیح‌نشده: {unexplained}
          </p>
        ) : null}
        {canReview && showDiff && row.status !== 'RESOLVED' ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>کد دلیل</Label>
              <select
                className="mt-1 block w-full rounded-md border px-2 py-2 text-sm"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
              >
                {REASON_CODES.map((code) => (
                  <option key={code} value={code}>
                    {discrepancyReasonLabel(code)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>مبلغ دلیل</Label>
              <Input
                value={reasonAmount}
                onChange={(e) => setReasonAmount(e.target.value)}
                placeholder={row.differenceAmount}
              />
            </div>
            <div>
              <Label>توضیح</Label>
              <Input value={reasonDesc} onChange={(e) => setReasonDesc(e.target.value)} />
            </div>
            <Button
              disabled={!reasonAmount || discMut.isPending}
              onClick={() => discMut.mutate()}
            >
              افزودن دلیل
            </Button>
            {row.status !== 'UNDER_REVIEW' ? (
              <Button variant="outline" onClick={() => reviewMut.mutate()} disabled={reviewMut.isPending}>
                انتقال به بررسی
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      {canResolve && row.status !== 'RESOLVED' && row.status !== 'CANCELLED' ? (
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">حل مغایرت</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>نوع حل</Label>
              <select
                className="mt-1 block w-full rounded-md border px-2 py-2 text-sm"
                value={resolutionType}
                onChange={(e) => setResolutionType(e.target.value)}
              >
                {[
                  'ACCEPTED_VARIANCE',
                  'EXPLAINED',
                  'ALLOCATION_CORRECTED',
                  'SOURCE_CORRECTED',
                  'FINANCE_TRANSACTION_CORRECTED',
                  'ADJUSTMENT_CREATED',
                  'OTHER',
                ].map((t) => (
                  <option key={t} value={t}>
                    {resolutionTypeLabel(t)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>یادداشت</Label>
              <Input
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
              />
            </div>
          </div>
          <Button disabled={resolveMut.isPending} onClick={() => resolveMut.mutate()}>
            ثبت حل
          </Button>
          {row.resolvedAt ? (
            <p className="text-xs text-muted-foreground">
              قبلاً حل شده در {formatDateTime(row.resolvedAt)} ·{' '}
              {row.resolutionType ? resolutionTypeLabel(row.resolutionType) : ''}
            </p>
          ) : null}
        </section>
      ) : null}

      {row.status === 'RESOLVED' ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 text-sm">
          حل‌شده — اختلاف تاریخی{' '}
          <span className="font-semibold tabular-nums">
            {formatSettlementMoney(row.differenceAmount, row.currency)}
          </span>{' '}
          حفظ شده است
          {row.resolutionType ? ` · ${resolutionTypeLabel(row.resolutionType)}` : ''}.
        </div>
      ) : null}
    </div>
  );
}
