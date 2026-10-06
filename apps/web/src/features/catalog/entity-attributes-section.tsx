'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  entityValueHasDisplay,
  formatEntityAttributeDisplay,
} from '@/features/catalog/attribute-utils';
import { EntityAttributesEditDialog } from '@/features/catalog/entity-attributes-edit-dialog';
import { ErrorState, PageSkeleton } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { fetchProductAttributes, fetchSkuAttributes } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { attributeKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

type EntityAttributesSectionProps = {
  entity: 'product' | 'sku';
  entityId: string;
  categoryId?: string | null;
  sectionTitle: string;
  editDialogTitle: string;
  canManage: boolean;
};

export function EntityAttributesSection({
  entity,
  entityId,
  categoryId,
  sectionTitle,
  editDialogTitle,
  canManage,
}: EntityAttributesSectionProps) {
  const { activeCompany } = useSession();
  const companyId = activeCompany?.id ?? '';
  const [editOpen, setEditOpen] = React.useState(false);

  const valuesQuery = useQuery({
    queryKey:
      entity === 'product'
        ? attributeKeys.productValues(companyId, entityId)
        : attributeKeys.skuValues(companyId, entityId),
    enabled: Boolean(companyId && entityId),
    queryFn: () =>
      entity === 'product'
        ? fetchProductAttributes(companyId, entityId)
        : fetchSkuAttributes(companyId, entityId),
  });

  const withValues = (valuesQuery.data ?? []).filter(entityValueHasDisplay);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{sectionTitle}</h2>
        {canManage ? (
          <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
            ویرایش مشخصات
          </Button>
        ) : null}
      </div>

      {valuesQuery.isLoading ? <PageSkeleton /> : null}
      {valuesQuery.isError ? (
        <ErrorState
          title="خطا در دریافت مشخصات"
          message={mapBusinessError(valuesQuery.error)}
          onRetry={() => void valuesQuery.refetch()}
        />
      ) : null}

      {!valuesQuery.isLoading && !valuesQuery.isError && withValues.length === 0 ? (
        <p className="text-sm text-slate-500">
          {entity === 'product'
            ? 'هنوز مشخصاتی برای این محصول ثبت نشده است.'
            : 'هنوز مشخصاتی برای این SKU ثبت نشده است.'}
        </p>
      ) : null}

      {withValues.length > 0 ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          {withValues.map((row) => (
            <div key={row.attributeId}>
              <dt className="text-xs font-medium text-slate-500">{row.attribute.name}</dt>
              <dd className="mt-1 text-sm text-slate-900">{formatEntityAttributeDisplay(row)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {canManage ? (
        <EntityAttributesEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          entity={entity}
          entityId={entityId}
          categoryId={categoryId}
          title={editDialogTitle}
        />
      ) : null}
    </section>
  );
}
