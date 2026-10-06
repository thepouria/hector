'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BarcodeGlyph } from '@/components/catalog/barcode-glyph';
import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import {
  archiveBarcode,
  createSkuBarcode,
  detectBarcodeType,
  generateInternalBarcode,
  fetchSkuBarcodes,
  setPrimaryBarcode,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { barcodeKeys } from '@/lib/query/keys';
import { catalogSkuBarcodePrintPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { Barcode, BarcodeType } from '@/types/catalog';

const BARCODE_TYPES: BarcodeType[] = ['EAN13', 'EAN8', 'UPC_A', 'CODE128', 'INTERNAL', 'OTHER'];

const selectClassName =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

function typeLabel(type: string): string {
  switch (type) {
    case 'EAN13':
      return 'EAN-13';
    case 'EAN8':
      return 'EAN-8';
    case 'UPC_A':
      return 'UPC-A';
    case 'CODE128':
      return 'CODE128';
    case 'INTERNAL':
      return 'داخلی';
    default:
      return 'سایر';
  }
}

type SkuBarcodesPanelProps = {
  skuId: string;
  canManage: boolean;
};

export function SkuBarcodesPanel({ skuId, canManage }: SkuBarcodesPanelProps) {
  const { activeCompany } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [type, setType] = React.useState<BarcodeType>('OTHER');
  const [asPrimary, setAsPrimary] = React.useState(false);
  const [archiveTarget, setArchiveTarget] = React.useState<Barcode | null>(null);

  const listQuery = useQuery({
    queryKey: barcodeKeys.bySku(companyId, skuId),
    queryFn: () => fetchSkuBarcodes(companyId, skuId),
    enabled: Boolean(companyId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: barcodeKeys.bySku(companyId, skuId) });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createSkuBarcode(companyId, skuId, {
        value,
        type,
        isPrimary: asPrimary || undefined,
      }),
    onSuccess: async () => {
      toast.success('بارکد اضافه شد');
      setAddOpen(false);
      setValue('');
      setType('OTHER');
      setAsPrimary(false);
      await invalidate();
    },
    onError: (error) => {
      toast.error(isApiClientError(error) ? mapBusinessError(error) : 'خطا در افزودن بارکد');
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => generateInternalBarcode(companyId, skuId),
    onSuccess: async () => {
      toast.success('بارکد داخلی ساخته شد');
      await invalidate();
    },
    onError: (error) => {
      toast.error(isApiClientError(error) ? mapBusinessError(error) : 'خطا در ساخت بارکد داخلی');
    },
  });

  const primaryMutation = useMutation({
    mutationFn: (barcodeId: string) => setPrimaryBarcode(companyId, barcodeId),
    onSuccess: async () => {
      toast.success('بارکد اصلی به‌روز شد');
      await invalidate();
    },
    onError: (error) => {
      toast.error(isApiClientError(error) ? mapBusinessError(error) : 'خطا');
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (barcodeId: string) => archiveBarcode(companyId, barcodeId),
    onSuccess: async () => {
      toast.success('بارکد آرشیو شد');
      setArchiveTarget(null);
      await invalidate();
    },
    onError: (error) => {
      toast.error(isApiClientError(error) ? mapBusinessError(error) : 'خطا در آرشیو');
    },
  });

  const suggestType = async (raw: string) => {
    if (!companyId || !raw.trim()) return;
    try {
      const detected = await detectBarcodeType(companyId, raw);
      if (detected.suggested) setType(detected.suggested);
    } catch {
      // suggestion only
    }
  };

  if (listQuery.isLoading) return <PageSkeleton />;
  if (listQuery.isError) {
    return (
      <ErrorState
        title="بارگذاری بارکدها ناموفق بود"
        onRetry={() => void listQuery.refetch()}
      />
    );
  }

  const rows = listQuery.data ?? [];
  const active = rows.filter((b) => !b.archivedAt);
  const hasActiveInternal = active.some((b) => b.type === 'INTERNAL');

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">بارکدها</h2>
          <p className="text-sm text-slate-500">
            شناسه قابل اسکن که به این SKU متصل است (نه موجودی انبار).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={catalogSkuBarcodePrintPath(skuId)}
            className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-4 text-sm hover:bg-slate-50"
          >
            چاپ لیبل
          </Link>
          {canManage ? (
            <>
              <Button
                variant="outline"
                disabled={hasActiveInternal || generateMutation.isPending}
                onClick={() => generateMutation.mutate()}
              >
                ساخت بارکد داخلی
              </Button>
              <Button onClick={() => setAddOpen(true)}>+ افزودن بارکد</Button>
            </>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">بارکدی برای این SKU ثبت نشده است.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-right font-medium">بارکد</th>
                <th className="px-3 py-2 text-right font-medium">نوع</th>
                <th className="px-3 py-2 text-right font-medium">اصلی</th>
                <th className="px-3 py-2 text-right font-medium">وضعیت</th>
                <th className="px-3 py-2 text-right font-medium">ایجاد</th>
                <th className="px-3 py-2 text-right font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span dir="ltr" className="font-mono text-slate-900">
                      {row.value}
                    </span>
                  </td>
                  <td className="px-3 py-2">{typeLabel(row.type)}</td>
                  <td className="px-3 py-2">
                    {row.isPrimary && !row.archivedAt ? (
                      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800">
                        بارکد اصلی
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.archivedAt ? (
                      <Badge className="text-slate-500">آرشیو</Badge>
                    ) : (
                      <Badge>فعال</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{formatDateTime(row.createdAt)}</td>
                  <td className="px-3 py-2">
                    {canManage && !row.archivedAt ? (
                      <RowActionsMenu
                        actions={[
                          ...(!row.isPrimary
                            ? [
                                {
                                  label: 'انتخاب به عنوان اصلی',
                                  onSelect: () => primaryMutation.mutate(row.id),
                                },
                              ]
                            : []),
                          {
                            label: 'آرشیو بارکد',
                            onSelect: () => setArchiveTarget(row),
                            danger: true,
                          },
                        ]}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active[0] ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-4">
          <p className="mb-2 text-xs text-slate-500">پیش‌نمایش بارکد اصلی / اولین فعال</p>
          <BarcodeGlyph
            barcode={active.find((b) => b.isPrimary) ?? active[0]}
            className="mx-auto max-w-full"
          />
        </div>
      ) : null}

      <Dialog open={addOpen} onOpenChange={setAddOpen} title="افزودن بارکد">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="bc-value">مقدار بارکد</Label>
            <Input
              id="bc-value"
              dir="ltr"
              className="font-mono text-left"
              value={value}
              autoFocus
              placeholder="اسکن یا وارد کردن..."
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => void suggestType(value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void suggestType(value);
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bc-type">نوع</Label>
            <select
              id="bc-type"
              className={selectClassName}
              value={type}
              onChange={(e) => setType(e.target.value as BarcodeType)}
            >
              {BARCODE_TYPES.filter((t) => t !== 'INTERNAL').map((t) => (
                <option key={t} value={t}>
                  {typeLabel(t)}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              بارکد داخلی را با دکمه «ساخت بارکد داخلی» ایجاد کنید.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={asPrimary}
              onChange={(e) => setAsPrimary(e.target.checked)}
            />
            تنظیم به عنوان بارکد اصلی
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              انصراف
            </Button>
            <Button
              disabled={!value.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              ذخیره
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="آرشیو بارکد"
        description="این بارکد دیگر برای عملیات جدید استفاده نمی‌شود اما سابقه آن حفظ خواهد شد."
        confirmLabel="آرشیو"
        loading={archiveMutation.isPending}
        onConfirm={() => archiveTarget && archiveMutation.mutate(archiveTarget.id)}
      />
    </section>
  );
}
