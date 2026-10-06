'use client';

import * as React from 'react';
import Link from 'next/link';
import { AccessDenied } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BarcodeScanInput } from '@/components/catalog/barcode-scan-input';
import { resolveBarcode } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { ROUTES, catalogProductPath, catalogSkuPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { BarcodeResolveResult } from '@/types/catalog';

type ScanState =
  | { status: 'idle' }
  | { status: 'resolving'; value: string }
  | { status: 'success'; value: string; data: BarcodeResolveResult }
  | { status: 'error'; value: string; message: string };

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'آرشیو';
  return status;
}

export function BarcodeScanTestPage() {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.CATALOG_READ);
  const [state, setState] = React.useState<ScanState>({ status: 'idle' });
  const focusToken = React.useRef(0);

  if (!canRead) return <AccessDenied />;

  const onScan = async (value: string) => {
    if (!companyId) return;
    const token = ++focusToken.current;
    setState({ status: 'resolving', value });
    try {
      const data = await resolveBarcode(companyId, value);
      if (token !== focusToken.current) return;
      setState({ status: 'success', value, data });
    } catch (error) {
      if (token !== focusToken.current) return;
      setState({
        status: 'error',
        value,
        message: isApiClientError(error)
          ? mapBusinessError(error)
          : 'خطا در بررسی بارکد. دوباره تلاش کنید.',
      });
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="تست اسکن بارکد"
        description="بارکد را اسکن کنید یا به صورت دستی وارد کنید. این صفحه فقط هویت را نشان می‌دهد و موجودی را تغییر نمی‌دهد."
        breadcrumbs={[{ label: 'کاتالوگ', href: ROUTES.catalog }, { label: 'تست اسکن' }]}
      />

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <BarcodeScanInput key={companyId ?? 'none'} onScan={onScan} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            focusToken.current += 1;
            setState({ status: 'idle' });
          }}
        >
          پاک کردن نتیجه
        </Button>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">نتیجه</h2>
        {state.status === 'idle' ? (
          <p className="text-sm text-slate-500">هنوز بارکدی اسکن نشده است.</p>
        ) : null}
        {state.status === 'resolving' ? (
          <p className="text-sm text-slate-600">در حال بررسی…</p>
        ) : null}
        {state.status === 'error' ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium text-red-700">{state.message}</p>
            <p dir="ltr" className="font-mono text-slate-500">
              {state.value}
            </p>
          </div>
        ) : null}
        {state.status === 'success' ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">محصول</dt>
              <dd>
                <Link
                  href={catalogProductPath(state.data.product.id)}
                  className="underline-offset-2 hover:underline"
                >
                  {state.data.product.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">SKU</dt>
              <dd>
                <Link
                  href={catalogSkuPath(state.data.sku.id)}
                  className="font-mono underline-offset-2 hover:underline"
                  dir="ltr"
                >
                  {state.data.sku.code}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">تنوع</dt>
              <dd>
                {state.data.sku.variantValues.length > 0
                  ? state.data.sku.variantValues
                      .map((v) => `${v.optionName} ${v.value}`)
                      .join(' / ')
                  : state.data.sku.name || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">نوع بارکد</dt>
              <dd dir="ltr">{state.data.barcode.type}</dd>
            </div>
            <div>
              <dt className="text-slate-500">وضعیت SKU</dt>
              <dd>
                <Badge>{statusLabel(state.data.sku.status)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">وضعیت محصول</dt>
              <dd>
                <Badge>{statusLabel(state.data.product.status)}</Badge>
              </dd>
            </div>
          </dl>
        ) : null}
      </section>
    </div>
  );
}
