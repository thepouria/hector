'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ErrorState, TableSkeleton } from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import {
  createVariantOption,
  createVariantValues,
  fetchVariantOptions,
  setVariantValueActive,
  updateVariantOption,
  updateVariantValue,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { variantKeys } from '@/lib/query/keys';
import { useSession } from '@/providers/app-providers';
import type { VariantOption, VariantOptionValue } from '@/types/catalog';

type ProductVariantsPanelProps = {
  productId: string;
  canManage: boolean;
};

export function ProductVariantsPanel({ productId, canManage }: ProductVariantsPanelProps) {
  const { activeCompany, can } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';

  const [addOptionOpen, setAddOptionOpen] = React.useState(false);
  const [newOptionName, setNewOptionName] = React.useState('');
  const [renameOption, setRenameOption] = React.useState<VariantOption | null>(null);
  const [renameOptionName, setRenameOptionName] = React.useState('');
  const [addValuesOption, setAddValuesOption] = React.useState<VariantOption | null>(null);
  const [valuesText, setValuesText] = React.useState('');
  const [renameValue, setRenameValue] = React.useState<{
    option: VariantOption;
    value: VariantOptionValue;
  } | null>(null);
  const [renameValueText, setRenameValueText] = React.useState('');

  const optionsQuery = useQuery({
    queryKey: variantKeys.options(companyId, productId),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchVariantOptions(companyId, productId),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: variantKeys.options(companyId, productId) });
  };

  const createOptionMutation = useMutation({
    mutationFn: () =>
      createVariantOption(companyId, productId, { name: newOptionName.trim() }),
    onSuccess: async () => {
      toast.success('ویژگی تنوع اضافه شد.');
      setAddOptionOpen(false);
      setNewOptionName('');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const renameOptionMutation = useMutation({
    mutationFn: () =>
      updateVariantOption(companyId, renameOption!.id, { name: renameOptionName.trim() }),
    onSuccess: async () => {
      toast.success('نام ویژگی به‌روز شد.');
      setRenameOption(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const addValuesMutation = useMutation({
    mutationFn: () => {
      const lines = valuesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return createVariantValues(companyId, addValuesOption!.id, lines);
    },
    onSuccess: async () => {
      toast.success('مقادیر اضافه شدند.');
      setAddValuesOption(null);
      setValuesText('');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const renameValueMutation = useMutation({
    mutationFn: () =>
      updateVariantValue(companyId, renameValue!.value.id, { value: renameValueText.trim() }),
    onSuccess: async () => {
      toast.success('مقدار به‌روز شد.');
      setRenameValue(null);
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const toggleValueMutation = useMutation({
    mutationFn: ({ valueId, active }: { valueId: string; active: boolean }) =>
      setVariantValueActive(companyId, valueId, active),
    onSuccess: async (_data, variables) => {
      toast.success(variables.active ? 'مقدار فعال شد.' : 'مقدار غیرفعال شد.');
      await invalidate();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const options = optionsQuery.data ?? [];
  const loading =
    createOptionMutation.isPending ||
    renameOptionMutation.isPending ||
    addValuesMutation.isPending ||
    renameValueMutation.isPending ||
    toggleValueMutation.isPending;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">مدیریت ویژگی‌های تنوع</h2>
          <p className="mt-1 text-sm text-slate-500">
            ویژگی‌ها و مقادیر آن‌ها برای ساخت SKUهای متنوع این محصول استفاده می‌شوند.
          </p>
        </div>
        {canManage ? (
          <Button type="button" variant="outline" onClick={() => setAddOptionOpen(true)}>
            ویژگی جدید
          </Button>
        ) : null}
      </div>

      {optionsQuery.isLoading ? <TableSkeleton rows={3} /> : null}
      {optionsQuery.isError ? (
        <ErrorState
          title="خطا در دریافت ویژگی‌ها"
          message={mapBusinessError(optionsQuery.error)}
          onRetry={() => void optionsQuery.refetch()}
        />
      ) : null}

      {!optionsQuery.isLoading && !optionsQuery.isError && options.length === 0 ? (
        <p className="text-sm text-slate-500">
          هنوز ویژگی تنوعی تعریف نشده است. در صورت نبود ویژگی می‌توانید یک SKU ساده بسازید.
        </p>
      ) : null}

      {options.length > 0 ? (
        <div className="space-y-4">
          {options.map((option) => (
            <div key={option.id} className="rounded-md border border-slate-100 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{option.name}</span>
                {canManage ? (
                  <RowActionsMenu
                    actions={[
                      {
                        label: 'تغییر نام',
                        onSelect: () => {
                          setRenameOption(option);
                          setRenameOptionName(option.name);
                        },
                      },
                      {
                        label: 'افزودن مقادیر',
                        onSelect: () => {
                          setAddValuesOption(option);
                          setValuesText('');
                        },
                      },
                    ]}
                  />
                ) : null}
              </div>
              {option.values.length === 0 ? (
                <p className="text-sm text-slate-500">مقداری ثبت نشده است.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {option.values.map((value) => (
                    <li
                      key={value.id}
                      className="flex items-center gap-1 rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-sm"
                    >
                      <span>{value.value}</span>
                      <Badge
                        className={
                          value.isActive
                            ? undefined
                            : 'border-amber-200 bg-amber-50 text-amber-800'
                        }
                      >
                        {value.isActive ? 'فعال' : 'غیرفعال'}
                      </Badge>
                      {canManage ? (
                        <RowActionsMenu
                          actions={[
                            {
                              label: 'تغییر نام',
                              onSelect: () => {
                                setRenameValue({ option, value });
                                setRenameValueText(value.value);
                              },
                            },
                            value.isActive
                              ? {
                                  label: 'غیرفعال کردن',
                                  onSelect: () =>
                                    toggleValueMutation.mutate({ valueId: value.id, active: false }),
                                }
                              : {
                                  label: 'فعال‌سازی',
                                  onSelect: () =>
                                    toggleValueMutation.mutate({ valueId: value.id, active: true }),
                                },
                          ]}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <Dialog open={addOptionOpen} onOpenChange={setAddOptionOpen} title="ویژگی تنوع جدید">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createOptionMutation.mutate();
          }}
        >
          <p className="text-sm text-slate-600">
            پس از ایجاد SKU برای این محصول، افزودن ویژگی جدید امکان‌پذیر نیست.
          </p>
          <div className="space-y-1">
            <Label htmlFor="variant-option-name">نام ویژگی</Label>
            <Input
              id="variant-option-name"
              value={newOptionName}
              onChange={(event) => setNewOptionName(event.target.value)}
              placeholder="مثلاً رنگ یا سایز"
              required
              maxLength={64}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddOptionOpen(false)}>
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={createOptionMutation.isPending || !newOptionName.trim()}
            >
              {createOptionMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(renameOption)}
        onOpenChange={(open) => {
          if (!open) setRenameOption(null);
        }}
        title="تغییر نام ویژگی"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            renameOptionMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="rename-option-name">نام</Label>
            <Input
              id="rename-option-name"
              value={renameOptionName}
              onChange={(event) => setRenameOptionName(event.target.value)}
              required
              maxLength={64}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenameOption(null)}>
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={renameOptionMutation.isPending || !renameOptionName.trim()}
            >
              {renameOptionMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(addValuesOption)}
        onOpenChange={(open) => {
          if (!open) setAddValuesOption(null);
        }}
        title={`افزودن مقادیر — ${addValuesOption?.name ?? ''}`}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            addValuesMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="variant-values-lines">مقادیر (هر خط یک مقدار)</Label>
            <textarea
              id="variant-values-lines"
              className="flex min-h-[120px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              value={valuesText}
              onChange={(event) => setValuesText(event.target.value)}
              placeholder={'01\n02\n03'}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAddValuesOption(null)}>
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={
                addValuesMutation.isPending ||
                !valuesText.split('\n').some((line) => line.trim())
              }
            >
              {addValuesMutation.isPending ? 'در حال ذخیره...' : 'افزودن'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(renameValue)}
        onOpenChange={(open) => {
          if (!open) setRenameValue(null);
        }}
        title="تغییر نام مقدار"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            renameValueMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="rename-value-text">مقدار</Label>
            <Input
              id="rename-value-text"
              value={renameValueText}
              onChange={(event) => setRenameValueText(event.target.value)}
              required
              maxLength={64}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setRenameValue(null)}>
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={renameValueMutation.isPending || !renameValueText.trim() || loading}
            >
              {renameValueMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
