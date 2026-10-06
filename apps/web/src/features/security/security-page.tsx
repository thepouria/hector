'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  fetchSessions,
  revokeSessionRequest,
} from '@/lib/api/auth';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { sessionKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { AuthSession } from '@/types/api';

function summarizeUserAgent(userAgent: string | null): string {
  if (!userAgent) return 'دستگاه ناشناس';
  const ua = userAgent;
  if (/Edg\//i.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return 'Google Chrome';
  if (/Firefox\//i.test(ua)) return 'Mozilla Firefox';
  if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return 'Safari';
  return ua.slice(0, 64);
}

export function SecurityPageClient() {
  const { user, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const [revokeTarget, setRevokeTarget] = React.useState<AuthSession | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = React.useState(false);

  const sessionsQuery = useQuery({
    queryKey: sessionKeys.list(),
    queryFn: fetchSessions,
  });

  React.useEffect(() => {
    if (
      sessionsQuery.error &&
      isApiClientError(sessionsQuery.error) &&
      sessionsQuery.error.status === 401
    ) {
      handleUnauthorized();
    }
  }, [sessionsQuery.error, handleUnauthorized]);

  const revokeMutation = useMutation({
    mutationFn: (session: AuthSession) => revokeSessionRequest(session.id),
    onSuccess: async (_data, session) => {
      setRevokeTarget(null);
      if (session.current) {
        toast.success('نشست فعلی بسته شد.');
        handleUnauthorized();
        return;
      }
      toast.success('نشست بسته شد.');
      await queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const revokeOthersMutation = useMutation({
    mutationFn: async (sessions: AuthSession[]) => {
      const others = sessions.filter((session) => !session.current && !session.revoked);
      for (const session of others) {
        await revokeSessionRequest(session.id);
      }
      return others.length;
    },
    onSuccess: async (count) => {
      setRevokeOthersOpen(false);
      toast.success(count > 0 ? `از ${count} دستگاه دیگر خارج شدید.` : 'نشست دیگری وجود نداشت.');
      await queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const activeSessions =
    sessionsQuery.data?.filter((session) => !session.revoked) ?? [];

  return (
    <div>
      <PageHeader
        title="امنیت"
        description="مدیریت نشست‌های حساب کاربری"
        breadcrumbs={[
          { label: 'تنظیمات', href: ROUTES.settings },
          { label: 'امنیت' },
        ]}
      />

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">حساب کاربری</h2>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-slate-500">نام</div>
            <div>
              {user ? `${user.firstName} ${user.lastName}`.trim() || user.email : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">ایمیل</div>
            <div dir="ltr">{user?.email ?? '—'}</div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">نشست‌های فعال</h2>
            <p className="mt-1 text-sm text-slate-500">
              دستگاه‌هایی که هم‌اکنون به حساب شما متصل هستند.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={activeSessions.filter((session) => !session.current).length === 0}
            onClick={() => setRevokeOthersOpen(true)}
          >
            خروج از سایر دستگاه‌ها
          </Button>
        </div>

        {sessionsQuery.isLoading ? <PageSkeleton /> : null}
        {sessionsQuery.error ? (
          <ErrorState
            message={isApiClientError(sessionsQuery.error) ? sessionsQuery.error.message : undefined}
            onRetry={() => void sessionsQuery.refetch()}
          />
        ) : null}

        {!sessionsQuery.isLoading && activeSessions.length === 0 ? (
          <EmptyState title="نشست فعالی پیدا نشد." />
        ) : null}

        {activeSessions.length > 0 ? (
          <div className="space-y-3">
            {activeSessions.map((session) => (
              <div
                key={session.id}
                className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {summarizeUserAgent(session.userAgent)}
                    </span>
                    {session.current ? <Badge>این نشست</Badge> : null}
                  </div>
                  <div className="text-xs text-slate-500">
                    آخرین استفاده: {formatDateTime(session.lastUsedAt)}
                  </div>
                  <div className="text-xs text-slate-500">
                    ایجاد: {formatDateTime(session.createdAt)}
                  </div>
                  {session.ipAddress ? (
                    <div className="font-mono text-xs text-slate-400" dir="ltr">
                      IP: {session.ipAddress}
                    </div>
                  ) : null}
                </div>
                <Button
                  variant={session.current ? 'danger' : 'outline'}
                  size="sm"
                  onClick={() => setRevokeTarget(session)}
                >
                  {session.current ? 'خروج از این دستگاه' : 'خروج از دستگاه'}
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="خروج از دستگاه"
        description={
          revokeTarget?.current
            ? 'با بستن این نشست، از Hector خارج می‌شوید و باید دوباره وارد شوید.'
            : 'این نشست روی دستگاه دیگر بسته می‌شود.'
        }
        target={
          revokeTarget
            ? `${summarizeUserAgent(revokeTarget.userAgent)}${
                revokeTarget.ipAddress ? ` · ${revokeTarget.ipAddress}` : ''
              }`
            : undefined
        }
        confirmLabel="خروج از دستگاه"
        danger
        loading={revokeMutation.isPending}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget)}
      />

      <ConfirmDialog
        open={revokeOthersOpen}
        onOpenChange={setRevokeOthersOpen}
        title="خروج از سایر دستگاه‌ها"
        description="همه نشست‌های فعال به‌جز نشست فعلی بسته می‌شوند."
        confirmLabel="خروج از سایر دستگاه‌ها"
        danger
        loading={revokeOthersMutation.isPending}
        onConfirm={() =>
          revokeOthersMutation.mutate(sessionsQuery.data ?? [])
        }
      />
    </div>
  );
}
