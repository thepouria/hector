'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState, PageSkeleton } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EntityAttributesSection } from '@/features/catalog/entity-attributes-section';
import { EntityHistory } from '@/features/catalog/entity-history';
import { SkuBarcodesPanel } from '@/features/catalog/sku-barcodes-panel';
import { fetchSku } from '@/lib/api/hector';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { skuKeys } from '@/lib/query/keys';
import { ROUTES, catalogProductPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'آرشیو';
  return status;
}

export function SkuDetailPage() {
  const params = useParams<{ id: string }>();
  const skuId = params.id;
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canRead = can(PERMISSIONS.CATALOG_READ);
  const canManage = can(PERMISSIONS.CATALOG_MANAGE);

  const skuQuery = useQuery({
    queryKey: skuKeys.detail(companyId, skuId),
    queryFn: () => fetchSku(companyId, skuId),
    enabled: Boolean(companyId && skuId && canRead),
  });

  if (!canRead) {
    return <AccessDenied />;
  }

  if (skuQuery.isLoading) return <PageSkeleton />;
  if (skuQuery.isError || !skuQuery.data) {
    return (
      <ErrorState
        title="SKU پیدا نشد"
        onRetry={() => void skuQuery.refetch()}
      />
    );
  }

  const sku = skuQuery.data;
  const variantLabel =
    sku.variantValues.length > 0
      ? sku.variantValues.map((v) => `${v.optionName}: ${v.value}`).join(' / ')
      : sku.name || '—';

  return (
    <div className="space-y-6">
      <PageHeader
        title={sku.code}
        description={sku.product.name}
        breadcrumbs={[
          { label: 'کاتالوگ', href: ROUTES.catalog },
          { label: 'SKUها', href: ROUTES.catalogSkus },
          { label: sku.product.name, href: catalogProductPath(sku.productId) },
          { label: sku.code },
        ]}
        actions={
          <Button variant="outline" onClick={() => router.push(catalogProductPath(sku.productId))}>
            بازگشت به محصول
          </Button>
        }
      />

      <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">کد SKU</dt>
            <dd dir="ltr" className="font-mono font-medium text-slate-900">
              {sku.code}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">وضعیت</dt>
            <dd>
              <Badge>{statusLabel(sku.status)}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">محصول</dt>
            <dd>
              <Link
                href={catalogProductPath(sku.productId)}
                className="text-slate-900 underline-offset-2 hover:underline"
              >
                {sku.product.name}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">تنوع</dt>
            <dd>{variantLabel}</dd>
          </div>
        </dl>
      </section>

      <EntityAttributesSection
        entity="sku"
        entityId={skuId}
        sectionTitle="مشخصات SKU"
        editDialogTitle="ویرایش مشخصات SKU"
        canManage={canManage}
      />

      <SkuBarcodesPanel skuId={skuId} canManage={canManage} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">تاریخچه</h2>
        <EntityHistory entityType="SKU" entityId={skuId} />
      </section>
    </div>
  );
}
