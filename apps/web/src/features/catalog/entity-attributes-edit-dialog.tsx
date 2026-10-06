'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AttributeFieldRow } from '@/features/catalog/attribute-value-fields';
import {
  buildPutPayloadFromDrafts,
  draftFromEntityValue,
  emptyDraft,
  mergeDefinition,
  scopeMatchesEntity,
  type AttributeDraftValue,
} from '@/features/catalog/attribute-utils';
import { ErrorState } from '@/components/feedback/states';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  fetchAttribute,
  fetchAttributes,
  fetchCategorySuggestedAttributes,
  fetchProductAttributes,
  fetchSkuAttributes,
  putProductAttributes,
  putSkuAttributes,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { attributeKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';
import type { AttributeDefinition } from '@/types/catalog';

const selectClassName =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

type EntityAttributesEditDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: 'product' | 'sku';
  entityId: string;
  categoryId?: string | null;
  title: string;
};

export function EntityAttributesEditDialog({
  open,
  onOpenChange,
  entity,
  entityId,
  categoryId,
  title,
}: EntityAttributesEditDialogProps) {
  const { activeCompany } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = React.useState<Map<string, AttributeDraftValue>>(new Map());
  const [addAttributeId, setAddAttributeId] = React.useState('');
  const [initialized, setInitialized] = React.useState(false);

  const valuesQuery = useQuery({
    queryKey:
      entity === 'product'
        ? attributeKeys.productValues(companyId, entityId)
        : attributeKeys.skuValues(companyId, entityId),
    enabled: Boolean(companyId && entityId && open),
    queryFn: () =>
      entity === 'product'
        ? fetchProductAttributes(companyId, entityId)
        : fetchSkuAttributes(companyId, entityId),
  });

  const suggestedQuery = useQuery({
    queryKey: attributeKeys.categorySuggested(companyId, categoryId ?? ''),
    enabled: Boolean(companyId && open && entity === 'product' && categoryId),
    queryFn: () => fetchCategorySuggestedAttributes(companyId, categoryId!),
  });

  const pickerQuery = useQuery({
    queryKey: attributeKeys.list(companyId, { status: 'ACTIVE', page: 1, pageSize: 200, for: 'attr-picker' }),
    enabled: Boolean(companyId && open),
    queryFn: () => fetchAttributes(companyId, { status: 'ACTIVE', page: 1, pageSize: 200 }),
  });

  React.useEffect(() => {
    if (!open) {
      setInitialized(false);
      setDrafts(new Map());
      setAddAttributeId('');
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || initialized || valuesQuery.isLoading) return;
    if (valuesQuery.isError) return;

    const suggested = suggestedQuery.data ?? [];
    const existing = valuesQuery.data ?? [];
    const suggestedIds = new Set(
      suggested
        .map((s) => s.attribute)
        .filter((a) => scopeMatchesEntity(a.scope, entity))
        .map((a) => a.id),
    );

    void (async () => {
      const next = new Map<string, AttributeDraftValue>();

      for (const row of suggested) {
        if (!scopeMatchesEntity(row.attribute.scope, entity)) continue;
        let def = row.attribute;
        if (
          (def.type === 'SINGLE_SELECT' || def.type === 'MULTI_SELECT') &&
          !def.options?.length
        ) {
          def = await fetchAttribute(companyId, def.id);
        }
        const existingValue = existing.find((v) => v.attributeId === def.id);
        next.set(
          def.id,
          existingValue ? draftFromEntityValue(def, existingValue) : emptyDraft(def),
        );
      }

      for (const value of existing) {
        if (suggestedIds.has(value.attributeId)) continue;
        if (!scopeMatchesEntity(value.attribute.scope, entity)) continue;
        let def = mergeDefinition(value.attribute);
        if (
          (def.type === 'SINGLE_SELECT' || def.type === 'MULTI_SELECT') &&
          !def.options?.length
        ) {
          def = await fetchAttribute(companyId, def.id);
        }
        next.set(def.id, draftFromEntityValue(def, value));
      }

      setDrafts(next);
      setInitialized(true);
    })();
  }, [
    open,
    initialized,
    valuesQuery.isLoading,
    valuesQuery.isError,
    valuesQuery.data,
    suggestedQuery.data,
    companyId,
    entity,
  ]);

  const suggestedDrafts = React.useMemo(() => {
    const suggestedIds = new Set((suggestedQuery.data ?? []).map((s) => s.attributeId));
    return [...drafts.values()].filter((d) => suggestedIds.has(d.attributeId));
  }, [drafts, suggestedQuery.data]);

  const otherDrafts = React.useMemo(() => {
    const suggestedIds = new Set((suggestedQuery.data ?? []).map((s) => s.attributeId));
    return [...drafts.values()].filter((d) => !suggestedIds.has(d.attributeId));
  }, [drafts, suggestedQuery.data]);

  const pickerOptions = React.useMemo(() => {
    const rows = (pickerQuery.data?.data ?? []).filter(
      (a) => scopeMatchesEntity(a.scope, entity) && !drafts.has(a.id),
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  }, [pickerQuery.data, drafts, entity]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = buildPutPayloadFromDrafts([...drafts.values()]);
      if (entity === 'product') {
        return putProductAttributes(companyId, entityId, payload);
      }
      return putSkuAttributes(companyId, entityId, payload);
    },
    onSuccess: async () => {
      toast.success('مشخصات ذخیره شد.');
      onOpenChange(false);
      const key =
        entity === 'product'
          ? attributeKeys.productValues(companyId, entityId)
          : attributeKeys.skuValues(companyId, entityId);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const addAttribute = async () => {
    if (!addAttributeId) return;
    let def: AttributeDefinition | undefined = pickerQuery.data?.data.find(
      (a) => a.id === addAttributeId,
    );
    if (!def) return;
    if (
      (def.type === 'SINGLE_SELECT' || def.type === 'MULTI_SELECT') &&
      !def.options?.length
    ) {
      def = await fetchAttribute(companyId, def.id);
    }
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(def!.id, emptyDraft(def!));
      return next;
    });
    setAddAttributeId('');
  };

  const updateDraft = (id: string, draft: AttributeDraftValue) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.set(id, draft);
      return next;
    });
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} className="max-w-lg">
      {valuesQuery.isError ? (
        <ErrorState message={mapBusinessError(valuesQuery.error)} />
      ) : !initialized && valuesQuery.isLoading ? (
        <p className="text-sm text-slate-500">در حال بارگذاری...</p>
      ) : (
        <form
          className="max-h-[70vh] space-y-4 overflow-y-auto pe-1"
          onSubmit={(event) => {
            event.preventDefault();
            saveMutation.mutate();
          }}
        >
          {entity === 'product' && categoryId && suggestedDrafts.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">پیشنهادی از دسته‌بندی (اختیاری)</p>
              {suggestedDrafts.map((draft) => (
                <AttributeFieldRow
                  key={draft.attributeId}
                  draft={draft}
                  idPrefix="edit-suggested"
                  onChange={(next) => updateDraft(draft.attributeId, next)}
                />
              ))}
            </div>
          ) : null}

          {otherDrafts.length > 0 ? (
            <div className="space-y-3">
              <p className="text-xs font-medium text-slate-600">سایر مشخصات</p>
              {otherDrafts.map((draft) => (
                <AttributeFieldRow
                  key={draft.attributeId}
                  draft={draft}
                  idPrefix="edit-other"
                  onChange={(next) => updateDraft(draft.attributeId, next)}
                  onRemove={() => removeDraft(draft.attributeId)}
                />
              ))}
            </div>
          ) : null}

          {suggestedDrafts.length === 0 && otherDrafts.length === 0 ? (
            <p className="text-sm text-slate-500">
              مشخصه‌ای برای ویرایش نیست. می‌توانید از پایین مشخصه اضافه کنید.
            </p>
          ) : null}

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <Label htmlFor="add-attribute">افزودن مشخصه</Label>
            <div className="flex gap-2">
              <select
                id="add-attribute"
                className={selectClassName}
                value={addAttributeId}
                onChange={(event) => setAddAttributeId(event.target.value)}
              >
                <option value="">انتخاب مشخصه...</option>
                {pickerOptions.map((attr) => (
                  <option key={attr.id} value={attr.id}>
                    {attr.name} ({attr.code})
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" disabled={!addAttributeId} onClick={() => void addAttribute()}>
                افزودن
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'در حال ذخیره...' : 'ذخیره مشخصات'}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
