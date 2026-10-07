'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { channelStatusLabel, channelTypeLabel } from '@/features/sales/sales-labels';
import {
  activateSalesChannel,
  createSalesChannel,
  deactivateSalesChannel,
  fetchSalesChannels,
  updateSalesChannel,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { salesKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { SalesChannel, SalesChannelType } from '@/types/sales';

export function SalesChannelsPage() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canRead = can(PERMISSIONS.SALES_CHANNELS_READ);
  const canManage = can(PERMISSIONS.SALES_CHANNELS_MANAGE);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SalesChannel | null>(null);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<SalesChannelType>('WHOLESALE');
  const [notes, setNotes] = React.useState('');
  const [toggle, setToggle] = React.useState<SalesChannel | null>(null);

  const listQuery = useQuery({
    queryKey: salesKeys.channels.list(companyId, { pageSize: 100 }),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchSalesChannels(companyId, { pageSize: 100 }),
  });

  React.useEffect(() => {
    if (listQuery.error && isApiClientError(listQuery.error) && listQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [listQuery.error, handleUnauthorized]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editing) {
        return updateSalesChannel(companyId, editing.id, { name, notes: notes || null });
      }
      return createSalesChannel(companyId, {
        code: code.trim().toUpperCase(),
        name: name.trim(),
        type,
        notes: notes || undefined,
      });
    },
    onSuccess: async () => {
      toast.success(editing ? 'کانال به‌روز شد' : 'کانال ایجاد شد');
      setFormOpen(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: salesKeys.channels.all(companyId) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const toggleMut = useMutation({
    mutationFn: async () => {
      if (!toggle) return;
      return toggle.status === 'ACTIVE'
        ? deactivateSalesChannel(companyId, toggle.id)
        : activateSalesChannel(companyId, toggle.id);
    },
    onSuccess: async () => {
      toast.success('وضعیت کانال تغییر کرد');
      setToggle(null);
      await queryClient.invalidateQueries({ queryKey: salesKeys.channels.all(companyId) });
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) {
    return <AccessDenied message="برای مشاهده کانال‌ها به مجوز sales.channels.read نیاز است." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="کانال‌های فروش"
        description="کانال‌های شرکت فعال (مارکت‌پلیس‌ها با کد، نه enum جدا)"
        breadcrumbs={[{ label: 'فروش', href: ROUTES.sales }, { label: 'کانال‌ها' }]}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing(null);
                setCode('');
                setName('');
                setType('WHOLESALE');
                setNotes('');
                setFormOpen(true);
              }}
            >
              کانال جدید
            </Button>
          ) : null
        }
      />

      {listQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {listQuery.error ? (
        <ErrorState title="خطا" message={mapBusinessError(listQuery.error)} />
      ) : null}
      {listQuery.data?.data.length === 0 ? (
        <EmptyState title="کانالی نیست" description="اولین کانال را ایجاد کنید." />
      ) : null}

      {listQuery.data && listQuery.data.data.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-right">کد</th>
                <th className="px-3 py-2 text-right">نام</th>
                <th className="px-3 py-2 text-right">نوع</th>
                <th className="px-3 py-2 text-right">وضعیت</th>
                <th className="px-3 py-2 text-right">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.data.data.map((ch) => (
                <tr key={ch.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{ch.code}</td>
                  <td className="px-3 py-2">{ch.name}</td>
                  <td className="px-3 py-2">{channelTypeLabel(ch.type)}</td>
                  <td className="px-3 py-2">
                    <Badge>{channelStatusLabel(ch.status)}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {canManage ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(ch);
                            setCode(ch.code);
                            setName(ch.name);
                            setType(ch.type);
                            setNotes(ch.notes ?? '');
                            setFormOpen(true);
                          }}
                        >
                          ویرایش
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setToggle(ch)}>
                          {ch.status === 'ACTIVE' ? 'غیرفعال' : 'فعال'}
                        </Button>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Dialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? 'ویرایش کانال' : 'کانال جدید'}
      >
        <div className="space-y-3">
          {!editing ? (
            <>
              <div className="space-y-1">
                <Label>کد</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WHOLESALE" />
              </div>
              <div className="space-y-1">
                <Label>نوع</Label>
                <select
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                  value={type}
                  onChange={(e) => setType(e.target.value as SalesChannelType)}
                >
                  {['WEBSITE', 'MARKETPLACE', 'WHOLESALE', 'MANUAL', 'OTHER'].map((t) => (
                    <option key={t} value={t}>
                      {channelTypeLabel(t)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}
          <div className="space-y-1">
            <Label>نام</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>یادداشت</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              انصراف
            </Button>
            <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
              ذخیره
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(toggle)}
        onOpenChange={(open) => !open && setToggle(null)}
        title={toggle?.status === 'ACTIVE' ? 'غیرفعال‌سازی کانال؟' : 'فعال‌سازی کانال؟'}
        description="حذف کانال پشتیبانی نمی‌شود؛ ترجیح با غیرفعال‌سازی است."
        confirmLabel="تأیید"
        onConfirm={() => toggleMut.mutate()}
        loading={toggleMut.isPending}
      />
    </div>
  );
}
