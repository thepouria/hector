'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { attributeScopeLabel } from '@/features/catalog/attribute-utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  fetchAttributes,
  fetchCategoryAttributes,
  replaceCategoryAttributes,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { attributeKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';

type CategoryAttributesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  categoryName: string;
};

type SelectedRow = {
  attributeId: string;
  name: string;
  position: number;
};

export function CategoryAttributesDialog({
  open,
  onOpenChange,
  categoryId,
  categoryName,
}: CategoryAttributesDialogProps) {
  const { activeCompany } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<SelectedRow[]>([]);
  const [addId, setAddId] = React.useState('');
  const [loaded, setLoaded] = React.useState(false);

  const assignedQuery = useQuery({
    queryKey: attributeKeys.categoryAssigned(companyId, categoryId),
    enabled: Boolean(companyId && categoryId && open),
    queryFn: () => fetchCategoryAttributes(companyId, categoryId),
  });

  const catalogQuery = useQuery({
    queryKey: attributeKeys.list(companyId, { status: 'ACTIVE', page: 1, pageSize: 200 }),
    enabled: Boolean(companyId && open),
    queryFn: () => fetchAttributes(companyId, { status: 'ACTIVE', page: 1, pageSize: 200 }),
  });

  React.useEffect(() => {
    if (!open) {
      setLoaded(false);
      setSelected([]);
      setAddId('');
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || loaded || assignedQuery.isLoading) return;
    const rows = (assignedQuery.data ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((row) => ({
        attributeId: row.attributeId,
        name: row.attribute.name,
        position: row.position,
      }));
    setSelected(rows);
    setLoaded(true);
  }, [open, loaded, assignedQuery.isLoading, assignedQuery.data]);

  const availableToAdd = (catalogQuery.data?.data ?? []).filter(
    (a) => !selected.some((s) => s.attributeId === a.id),
  );

  const saveMutation = useMutation({
    mutationFn: () =>
      replaceCategoryAttributes(
        companyId,
        categoryId,
        selected.map((row, index) => ({
          attributeId: row.attributeId,
          position: index,
          isVisible: true,
        })),
      ),
    onSuccess: async () => {
      toast.success('مشخصات پیشنهادی دسته‌بندی ذخیره شد.');
      onOpenChange(false);
      await queryClient.invalidateQueries({
        queryKey: attributeKeys.categoryAssigned(companyId, categoryId),
      });
      await queryClient.invalidateQueries({
        queryKey: attributeKeys.categorySuggested(companyId, categoryId),
      });
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const move = (index: number, dir: -1 | 1) => {
    setSelected((rows) => {
      const next = [...rows];
      const target = index + dir;
      if (target < 0 || target >= next.length) return rows;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((r, i) => ({ ...r, position: i }));
    });
  };

  const addRow = () => {
    const attr = availableToAdd.find((a) => a.id === addId);
    if (!attr) return;
    setSelected((rows) => [
      ...rows,
      { attributeId: attr.id, name: attr.name, position: rows.length },
    ]);
    setAddId('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="مشخصات پیشنهادی دسته‌بندی"
      description={`دسته‌بندی: ${categoryName} — پیکربندی خالی مجاز است.`}
      className="max-w-lg"
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate();
        }}
      >
        {selected.length === 0 ? (
          <p className="text-sm text-slate-500">هنوز مشخصه‌ای به این دسته اختصاص داده نشده است.</p>
        ) : (
          <ul className="space-y-2">
            {selected.map((row, index) => {
              const meta = catalogQuery.data?.data.find((a) => a.id === row.attributeId);
              return (
                <li
                  key={row.attributeId}
                  className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 font-medium text-slate-900">{row.name}</span>
                  {meta ? (
                    <span className="text-xs text-slate-500">{attributeScopeLabel(meta.scope)}</span>
                  ) : null}
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="outline" onClick={() => move(index, -1)}>
                      ↑
                    </Button>
                    <Button type="button" variant="outline" onClick={() => move(index, 1)}>
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setSelected((rows) => rows.filter((r) => r.attributeId !== row.attributeId))
                      }
                    >
                      حذف
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="space-y-2 border-t border-slate-100 pt-3">
          <Label htmlFor="cat-add-attr">افزودن مشخصه</Label>
          <div className="flex gap-2">
            <select
              id="cat-add-attr"
              className="flex h-10 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={addId}
              onChange={(event) => setAddId(event.target.value)}
            >
              <option value="">انتخاب...</option>
              {availableToAdd.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <Button type="button" variant="outline" disabled={!addId} onClick={addRow}>
              افزودن
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
