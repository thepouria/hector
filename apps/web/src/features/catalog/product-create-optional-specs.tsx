'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { AttributeFieldRow } from '@/features/catalog/attribute-value-fields';
import {
  buildPutPayloadFromDrafts,
  emptyDraft,
  scopeMatchesEntity,
  type AttributeDraftValue,
} from '@/features/catalog/attribute-utils';
import { cn } from '@/lib/utils/cn';
import { fetchAttribute, fetchCategorySuggestedAttributes } from '@/lib/api/hector';
import { attributeKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

export type ProductCreateSpecsHandle = {
  buildPayload: () => ReturnType<typeof buildPutPayloadFromDrafts>;
  hasAnyDraft: () => boolean;
};

type ProductCreateOptionalSpecsProps = {
  categoryId: string;
  companyId: string;
  onDraftsChange?: (drafts: AttributeDraftValue[]) => void;
};

export const ProductCreateOptionalSpecs = React.forwardRef<
  ProductCreateSpecsHandle,
  ProductCreateOptionalSpecsProps
>(function ProductCreateOptionalSpecs({ categoryId, companyId, onDraftsChange }, ref) {
  const { activeCompany } = useSession();
  const resolvedCompanyId = companyId || activeCompany?.id || '';
  const [expanded, setExpanded] = React.useState(false);
  const [drafts, setDrafts] = React.useState<Map<string, AttributeDraftValue>>(new Map());

  const suggestedQuery = useQuery({
    queryKey: attributeKeys.categorySuggested(resolvedCompanyId, categoryId),
    enabled: Boolean(resolvedCompanyId && categoryId && expanded),
    queryFn: () => fetchCategorySuggestedAttributes(resolvedCompanyId, categoryId),
  });

  React.useEffect(() => {
    if (!expanded || !suggestedQuery.data) return;
    void (async () => {
      const additions = new Map<string, AttributeDraftValue>();
      for (const row of suggestedQuery.data!) {
        if (!scopeMatchesEntity(row.attribute.scope, 'product')) continue;
        let def = row.attribute;
        if (
          (def.type === 'SINGLE_SELECT' || def.type === 'MULTI_SELECT') &&
          !def.options?.length
        ) {
          def = await fetchAttribute(resolvedCompanyId, def.id);
        }
        additions.set(def.id, emptyDraft(def));
      }
      setDrafts((prev) => {
        const merged = new Map<string, AttributeDraftValue>();
        for (const [id, d] of additions) {
          merged.set(id, prev.get(id) ?? d);
        }
        return merged;
      });
    })();
  }, [expanded, suggestedQuery.data, resolvedCompanyId]);

  React.useEffect(() => {
    setDrafts(new Map());
  }, [categoryId]);

  React.useEffect(() => {
    onDraftsChange?.([...drafts.values()]);
  }, [drafts, onDraftsChange]);

  React.useImperativeHandle(ref, () => ({
    buildPayload: () => buildPutPayloadFromDrafts([...drafts.values()]),
    hasAnyDraft: () => buildPutPayloadFromDrafts([...drafts.values()]).length > 0,
  }));

  const draftList = [...drafts.values()];

  return (
    <div className="rounded-md border border-dashed border-slate-200">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronLeft className="h-4 w-4 shrink-0" />
        )}
        مشخصات تکمیلی (اختیاری)
      </button>
      {expanded ? (
        <div className={cn('space-y-3 border-t border-slate-100 px-3 py-3')}>
          {!categoryId ? (
            <p className="text-sm text-slate-500">
              برای پیشنهاد مشخصات بر اساس دسته‌بندی، ابتدا دسته‌بندی را انتخاب کنید.
            </p>
          ) : suggestedQuery.isLoading ? (
            <p className="text-sm text-slate-500">در حال بارگذاری...</p>
          ) : draftList.length === 0 ? (
            <p className="text-sm text-slate-500">
              برای این دسته‌بندی مشخصهٔ پیشنهادی تنظیم نشده است. پس از ایجاد محصول می‌توانید
              مشخصات را از صفحهٔ محصول اضافه کنید.
            </p>
          ) : (
            draftList.map((draft) => (
              <AttributeFieldRow
                key={draft.attributeId}
                draft={draft}
                idPrefix="create-spec"
                onChange={(next) => {
                  setDrafts((prev) => {
                    const map = new Map(prev);
                    map.set(draft.attributeId, next);
                    return map;
                  });
                }}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
});
