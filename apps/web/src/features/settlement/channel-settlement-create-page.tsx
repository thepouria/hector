'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  componentTypeLabel,
  formatSettlementMoney,
} from '@/features/settlement/settlement-labels';
import { createChannelSettlement, fetchSalesChannels } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { settlementChannelPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

type ComponentDraft = {
  type: string;
  effect: 'INCREASE' | 'DECREASE';
  amount: string;
  description: string;
};

const DEFAULT_COMPONENTS: ComponentDraft[] = [
  { type: 'GROSS_SALES', effect: 'INCREASE', amount: '', description: '' },
  { type: 'COMMISSION', effect: 'DECREASE', amount: '', description: '' },
  { type: 'RETURN', effect: 'DECREASE', amount: '', description: '' },
  { type: 'FEE', effect: 'DECREASE', amount: '', description: 'Fee' },
];

function previewExpectedNet(components: ComponentDraft[]): string {
  let net = 0;
  for (const c of components) {
    const n = Number(c.amount || 0);
    if (!Number.isFinite(n)) continue;
    net += c.effect === 'INCREASE' ? n : -n;
  }
  return String(net);
}

export function ChannelSettlementCreatePage() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.FINANCE_SETTLEMENTS_MANAGE);

  const [channelId, setChannelId] = React.useState('');
  const [periodStart, setPeriodStart] = React.useState('');
  const [periodEnd, setPeriodEnd] = React.useState('');
  const [currency, setCurrency] = React.useState('IRR');
  const [externalReference, setExternalReference] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [components, setComponents] = React.useState<ComponentDraft[]>(DEFAULT_COMPONENTS);

  const channelsQuery = useQuery({
    queryKey: salesKeys.channels.list(companyId, { pageSize: 100, status: 'ACTIVE' }),
    enabled: Boolean(companyId) && canManage,
    queryFn: () => fetchSalesChannels(companyId, { pageSize: 100, status: 'ACTIVE' }),
  });

  React.useEffect(() => {
    if (
      channelsQuery.error &&
      isApiClientError(channelsQuery.error) &&
      channelsQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [channelsQuery.error, handleUnauthorized]);

  const createMut = useMutation({
    mutationFn: () =>
      createChannelSettlement(companyId, {
        channelId,
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
        currency,
        externalReference: externalReference || undefined,
        notes: notes || undefined,
        components: components
          .filter((c) => c.amount)
          .map((c) => ({
            type: c.type,
            effect: c.effect,
            amount: c.amount,
            ...(c.description ? { description: c.description } : {}),
          })),
        requestId: crypto.randomUUID(),
      }),
    onSuccess: (row) => {
      toast.success('تسویه کانال ایجاد شد');
      router.push(settlementChannelPath(row.id));
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canManage) {
    return <AccessDenied message="ایجاد تسویه کانال نیازمند finance.settlements.manage است." />;
  }
  if (channelsQuery.isLoading) return <PageSkeleton />;
  if (channelsQuery.isError) {
    return (
      <ErrorState
        message="بارگذاری کانال‌ها ناموفق بود."
        onRetry={() => channelsQuery.refetch()}
      />
    );
  }

  const preview = previewExpectedNet(components);

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="ایجاد تسویه کانال"
        description="پیش‌نمایش Expected Net فقط کمکی است؛ Backend منبع حقیقت است."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="channelId">کانال</Label>
          <select
            id="channelId"
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
          >
            <option value="">انتخاب…</option>
            {(channelsQuery.data?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="currency">ارز</Label>
          <select
            id="currency"
            className="mt-1 block w-full rounded-md border px-3 py-2 text-sm"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="IRR">IRR</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
        <div>
          <Label htmlFor="periodStart">شروع دوره</Label>
          <Input
            id="periodStart"
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="periodEnd">پایان دوره</Label>
          <Input
            id="periodEnd"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="externalReference">مرجع خارجی</Label>
          <Input
            id="externalReference"
            value={externalReference}
            onChange={(e) => setExternalReference(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="notes">یادداشت</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">اجزای صورتحساب</h2>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setComponents((prev) => [
                ...prev,
                { type: 'ADJUSTMENT', effect: 'INCREASE', amount: '', description: 'Adj' },
              ])
            }
          >
            افزودن جزء
          </Button>
        </div>
        <div className="space-y-3">
          {components.map((c, idx) => (
            <div key={idx} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4">
              <div>
                <Label>نوع</Label>
                <select
                  className="mt-1 block w-full rounded-md border px-2 py-2 text-sm"
                  value={c.type}
                  onChange={(e) => {
                    const next = [...components];
                    next[idx] = { ...c, type: e.target.value };
                    setComponents(next);
                  }}
                >
                  {['GROSS_SALES', 'COMMISSION', 'RETURN', 'FEE', 'ADJUSTMENT'].map((t) => (
                    <option key={t} value={t}>
                      {componentTypeLabel(t)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>اثر</Label>
                <select
                  className="mt-1 block w-full rounded-md border px-2 py-2 text-sm"
                  value={c.effect}
                  onChange={(e) => {
                    const next = [...components];
                    next[idx] = {
                      ...c,
                      effect: e.target.value as 'INCREASE' | 'DECREASE',
                    };
                    setComponents(next);
                  }}
                >
                  <option value="INCREASE">افزایش</option>
                  <option value="DECREASE">کاهش</option>
                </select>
              </div>
              <div>
                <Label>مبلغ</Label>
                <Input
                  value={c.amount}
                  onChange={(e) => {
                    const next = [...components];
                    next[idx] = { ...c, amount: e.target.value };
                    setComponents(next);
                  }}
                />
              </div>
              <div>
                <Label>توضیح</Label>
                <Input
                  value={c.description}
                  onChange={(e) => {
                    const next = [...components];
                    next[idx] = { ...c, description: e.target.value };
                    setComponents(next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <div className="text-muted-foreground">پیش‌نمایش Expected Net</div>
        <div className="text-xl font-semibold tabular-nums">
          {formatSettlementMoney(preview, currency)}
        </div>
      </div>

      <Button
        disabled={
          !channelId || !periodStart || !periodEnd || createMut.isPending || !components.some((c) => c.amount)
        }
        onClick={() => createMut.mutate()}
      >
        ایجاد پیش‌نویس
      </Button>
    </div>
  );
}
