'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from '@/components/feedback/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import {
  activateSku,
  archiveSku,
  bulkCreateSkus,
  createSku,
  deactivateSku,
  fetchAllProductSkus,
  fetchProductSkus,
  fetchVariantOptions,
  updateSku,
} from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { skuKeys, variantKeys } from '@/lib/query/keys';
import { catalogProductSkusPath, catalogSkuPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { Sku, VariantOption } from '@/types/catalog';
import {
  buildSkuCode,
  buildSkuName,
  countCombinations,
  generateCombinations,
  isValidSkuCode,
  VARIANT_GENERATION_MAX,
  type Combination,
  type GeneratorOption,
} from './variant-generation';

const selectClassName =
  'flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm';

type ProductSkusPanelProps = {
  productId: string;
  productCode: string | null;
  productName: string;
  productStatus: string;
  canManage: boolean;
};

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

function formatSkuVariant(sku: Sku): string {
  if (sku.variantValues.length === 0) return '—';
  return [...sku.variantValues]
    .sort((a, b) => a.optionPosition - b.optionPosition)
    .map((v) => `${v.optionName}: ${v.value}`)
    .join(' · ');
}

function buildVariantSignature(
  options: Array<{ id: string }>,
  optionValueIds: string[],
): string {
  const pairs = options.map((opt, index) => ({
    optionId: opt.id,
    optionValueId: optionValueIds[index]!,
  }));
  pairs.sort((a, b) => {
    if (a.optionId < b.optionId) return -1;
    if (a.optionId > b.optionId) return 1;
    if (a.optionValueId < b.optionValueId) return -1;
    if (a.optionValueId > b.optionValueId) return 1;
    return 0;
  });
  return pairs.map((p) => `${p.optionId}:${p.optionValueId}`).join('|');
}

function sortedOptions(options: VariantOption[]): VariantOption[] {
  return [...options].sort((a, b) => a.position - b.position);
}

function activeGeneratorOptions(options: VariantOption[]): GeneratorOption[] {
  return sortedOptions(options).map((option) => ({
    id: option.id,
    name: option.name,
    values: option.values
      .filter((value) => value.isActive)
      .sort((a, b) => a.position - b.position)
      .map((value) => ({ id: value.id, value: value.value })),
  }));
}

function combinationVariantLabel(
  generatorOptions: GeneratorOption[],
  combination: Combination,
): string {
  return generatorOptions
    .map((option, index) => `${option.name}: ${combination.labels[index]}`)
    .join(' · ');
}

type BulkRow = {
  optionValueIds: string[];
  code: string;
  name: string;
  variantLabel: string;
};

export function ProductSkusPanel({
  productId,
  productCode,
  productName,
  productStatus,
  canManage,
}: ProductSkusPanelProps) {
  const { activeCompany, can } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';

  const [page, setPage] = React.useState(1);
  const [searchInput, setSearchInput] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createCode, setCreateCode] = React.useState('');
  const [createName, setCreateName] = React.useState('');
  const [createSelections, setCreateSelections] = React.useState<Record<string, string>>({});

  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkRows, setBulkRows] = React.useState<BulkRow[]>([]);
  const [bulkLoading, setBulkLoading] = React.useState(false);

  const [editSku, setEditSku] = React.useState<Sku | null>(null);
  const [editCode, setEditCode] = React.useState('');
  const [editName, setEditName] = React.useState('');
  const [editSelections, setEditSelections] = React.useState<Record<string, string>>({});
  const [variantChangeConfirm, setVariantChangeConfirm] = React.useState(false);

  const [confirm, setConfirm] = React.useState<
    { type: 'deactivate' | 'activate' | 'archive'; sku: Sku } | null
  >(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = {
    page,
    pageSize: 20,
    search: search || undefined,
    status: status || undefined,
    sortBy: 'code',
    sortOrder: 'asc',
  };

  const optionsQuery = useQuery({
    queryKey: variantKeys.options(companyId, productId),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchVariantOptions(companyId, productId),
  });

  const skusQuery = useQuery({
    queryKey: skuKeys.list(companyId, productId, filters),
    enabled: Boolean(companyId) && can(PERMISSIONS.CATALOG_READ),
    queryFn: () => fetchProductSkus(companyId, productId, filters),
  });

  const variantOptions = React.useMemo(
    () => optionsQuery.data ?? [],
    [optionsQuery.data],
  );
  const hasVariantOptions = variantOptions.length > 0;
  const generatorOptions = React.useMemo(
    () => activeGeneratorOptions(variantOptions),
    [variantOptions],
  );
  const sortedVariantOptions = React.useMemo(
    () => sortedOptions(variantOptions),
    [variantOptions],
  );

  const invalidateSkus = async () => {
    await queryClient.invalidateQueries({ queryKey: skuKeys.byProduct(companyId, productId) });
    await queryClient.invalidateQueries({ queryKey: variantKeys.options(companyId, productId) });
  };

  const suggestCreateCode = (
    selections: Record<string, string>,
    options: VariantOption[],
  ): string => {
    if (!productCode || options.length !== 1) return '';
    const option = options[0]!;
    const valueId = selections[option.id];
    const value = option.values.find((item) => item.id === valueId);
    const raw = value ? `${productCode}-${value.value}` : '';
    return raw.toUpperCase();
  };

  const openCreate = () => {
    setCreateName('');
    const initial: Record<string, string> = {};
    for (const option of sortedVariantOptions) {
      const firstActive = option.values.find((value) => value.isActive);
      if (firstActive) initial[option.id] = firstActive.id;
    }
    setCreateSelections(initial);
    setCreateCode(suggestCreateCode(initial, sortedVariantOptions));
    setCreateOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        code: createCode.trim(),
        ...(createName.trim() ? { name: createName.trim() } : {}),
        ...(hasVariantOptions
          ? {
              optionValueIds: sortedVariantOptions.map((option) => createSelections[option.id]),
            }
          : {}),
      };
      return createSku(companyId, productId, body);
    },
    onSuccess: async () => {
      toast.success('SKU ایجاد شد.');
      setCreateOpen(false);
      await invalidateSkus();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editSku) throw new Error('missing sku');
      const payload: {
        code?: string;
        name?: string | null;
        optionValueIds?: string[];
      } = {
        code: editCode.trim(),
        name: editName.trim() ? editName.trim() : null,
      };
      if (hasVariantOptions) {
        payload.optionValueIds = sortedVariantOptions.map((option) => editSelections[option.id]);
      }
      return updateSku(companyId, editSku.id, payload);
    },
    onSuccess: async () => {
      toast.success('SKU به‌روز شد.');
      setEditSku(null);
      setVariantChangeConfirm(false);
      await invalidateSkus();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const deactivateMutation = useMutation({
    mutationFn: (skuId: string) => deactivateSku(companyId, skuId),
    onSuccess: async () => {
      toast.success('SKU غیرفعال شد.');
      setConfirm(null);
      await invalidateSkus();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const activateMutation = useMutation({
    mutationFn: (skuId: string) => activateSku(companyId, skuId),
    onSuccess: async () => {
      toast.success('SKU فعال شد.');
      setConfirm(null);
      await invalidateSkus();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: (skuId: string) => archiveSku(companyId, skuId),
    onSuccess: async () => {
      toast.success('SKU بایگانی شد.');
      setConfirm(null);
      await invalidateSkus();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const bulkMutation = useMutation({
    mutationFn: () =>
      bulkCreateSkus(
        companyId,
        productId,
        bulkRows.map((row) => ({
          code: row.code.trim(),
          ...(row.name.trim() ? { name: row.name.trim() } : {}),
          optionValueIds: row.optionValueIds,
        })),
      ),
    onSuccess: async (result) => {
      toast.success(`${result.meta.created} SKU ایجاد شد.`);
      setBulkOpen(false);
      setBulkRows([]);
      await invalidateSkus();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const openBulkGenerator = async () => {
    const missingActive = generatorOptions.some((option) => option.values.length === 0);
    if (missingActive) {
      toast.error('هر ویژگی باید حداقل یک مقدار فعال داشته باشد.');
      return;
    }
    const total = countCombinations(generatorOptions);
    if (total > VARIANT_GENERATION_MAX) {
      toast.error(
        `تعداد ترکیب‌ها (${total}) از حد مجاز (${VARIANT_GENERATION_MAX}) بیشتر است.`,
      );
      return;
    }
    const combinations = generateCombinations(generatorOptions);
    if (!combinations || combinations.length === 0) {
      toast.error('ترکیبی برای تولید وجود ندارد.');
      return;
    }

    setBulkLoading(true);
    try {
      const existing = await fetchAllProductSkus(companyId, productId);
      const existingSignatures = new Set(existing.map((sku) => sku.variantSignature));
      const prefix = productCode?.trim() || productName.trim().slice(0, 12) || 'SKU';

      const rows: BulkRow[] = [];
      for (const combination of combinations) {
        const signature = buildVariantSignature(generatorOptions, combination.optionValueIds);
        if (existingSignatures.has(signature)) continue;
        rows.push({
          optionValueIds: combination.optionValueIds,
          code: buildSkuCode(prefix, combination),
          name: buildSkuName(generatorOptions, combination),
          variantLabel: combinationVariantLabel(generatorOptions, combination),
        });
      }

      if (rows.length === 0) {
        toast.message('همه ترکیب‌ها از قبل SKU دارند.');
        return;
      }
      setBulkRows(rows);
      setBulkOpen(true);
    } catch (error) {
      toast.error(mapBusinessError(error));
    } finally {
      setBulkLoading(false);
    }
  };

  const openEdit = (sku: Sku) => {
    setEditSku(sku);
    setEditCode(sku.code);
    setEditName(sku.name ?? '');
    const selections: Record<string, string> = {};
    for (const value of sku.variantValues) {
      selections[value.optionId] = value.optionValueId;
    }
    setEditSelections(selections);
    setVariantChangeConfirm(false);
  };

  const editVariantChanged = React.useMemo(() => {
    if (!editSku || !hasVariantOptions) return false;
    const currentIds = [...editSku.variantValues]
      .sort((a, b) => a.optionPosition - b.optionPosition)
      .map((v) => v.optionValueId);
    const nextIds = sortedVariantOptions.map((option) => editSelections[option.id]);
    return currentIds.join('|') !== nextIds.join('|');
  }, [editSku, editSelections, hasVariantOptions, sortedVariantOptions]);

  const submitEdit = () => {
    if (editVariantChanged && !variantChangeConfirm) {
      setVariantChangeConfirm(true);
      return;
    }
    updateMutation.mutate();
  };

  const createValid =
    isValidSkuCode(createCode.trim()) &&
    (!hasVariantOptions ||
      sortedVariantOptions.every(
        (option) => createSelections[option.id] && createSelections[option.id].length > 0,
      ));

  const editValid =
    editSku &&
    isValidSkuCode(editCode.trim()) &&
    (!hasVariantOptions ||
      sortedVariantOptions.every(
        (option) => editSelections[option.id] && editSelections[option.id].length > 0,
      ));

  const bulkValid = bulkRows.length > 0 && bulkRows.every((row) => isValidSkuCode(row.code.trim()));

  const rows = skusQuery.data?.data ?? [];
  const meta = skusQuery.data?.meta;
  const totalPages = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;
  const lifecycleLoading =
    deactivateMutation.isPending || activateMutation.isPending || archiveMutation.isPending;

  const productArchived = productStatus === 'ARCHIVED';
  const canCreateSkus = canManage && !productArchived;

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">SKUها</h2>
          <p className="mt-1 text-sm text-slate-500">
            واحدهای قابل‌فروش و انبارداری این محصول ({productName})
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(catalogProductSkusPath(productId))}
          >
            نمایش در فهرست SKUها
          </Button>
          {canCreateSkus ? (
            <Button type="button" onClick={openCreate}>
              SKU جدید
            </Button>
          ) : null}
          {canCreateSkus && hasVariantOptions ? (
            <Button
              type="button"
              variant="outline"
              disabled={bulkLoading}
              onClick={() => void openBulkGenerator()}
            >
              {bulkLoading ? 'در حال آماده‌سازی...' : 'تولید گروهی SKU'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="sku-search">جستجو</Label>
          <Input
            id="sku-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="کد یا نام SKU"
          />
        </div>
        <div className="w-full space-y-1 sm:w-48">
          <Label htmlFor="sku-status">وضعیت</Label>
          <select
            id="sku-status"
            className={selectClassName}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">همه</option>
            <option value="ACTIVE">فعال</option>
            <option value="INACTIVE">غیرفعال</option>
            <option value="ARCHIVED">بایگانی</option>
          </select>
        </div>
      </div>

      {skusQuery.isLoading ? <TableSkeleton rows={6} /> : null}
      {skusQuery.isError ? (
        <ErrorState
          title="خطا در دریافت SKUها"
          message={mapBusinessError(skusQuery.error)}
          onRetry={() => void skusQuery.refetch()}
        />
      ) : null}

      {!skusQuery.isLoading && !skusQuery.isError && rows.length === 0 ? (
        <EmptyState
          title="SKU ثبت نشده است"
          description={
            hasVariantOptions
              ? 'با انتخاب مقادیر ویژگی‌ها SKU بسازید یا از تولید گروهی استفاده کنید.'
              : 'برای محصول بدون ویژگی تنوع، یک SKU ساده با کد داخلی ایجاد کنید.'
          }
          action={
            canCreateSkus ? (
              <Button type="button" onClick={openCreate}>
                ایجاد اولین SKU
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-right text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">کد SKU</th>
                <th className="px-4 py-3 font-medium">تنوع</th>
                <th className="px-4 py-3 font-medium">نام</th>
                <th className="px-4 py-3 font-medium">وضعیت</th>
                <th className="px-4 py-3 font-medium">به‌روزرسانی</th>
                <th className="px-4 py-3 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sku) => (
                <tr key={sku.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={catalogSkuPath(sku.id)}
                      className="font-mono underline-offset-2 hover:underline"
                      dir="ltr"
                    >
                      {sku.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatSkuVariant(sku)}</td>
                  <td className="px-4 py-3 text-slate-600">{sku.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <Badge>{statusLabel(sku.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDateTime(sku.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <RowActionsMenu
                      actions={[
                        {
                          label: 'بارکدها',
                          onSelect: () => router.push(catalogSkuPath(sku.id)),
                        },
                        ...(canManage
                          ? [
                              {
                                label: 'ویرایش',
                                onSelect: () => openEdit(sku),
                              },
                              ...(sku.status === 'ACTIVE'
                                ? [
                                    {
                                      label: 'غیرفعال کردن',
                                      onSelect: () => setConfirm({ type: 'deactivate', sku }),
                                    },
                                  ]
                                : []),
                              ...(sku.status === 'INACTIVE' || sku.status === 'ARCHIVED'
                                ? [
                                    {
                                      label: 'فعال‌سازی',
                                      onSelect: () => setConfirm({ type: 'activate', sku }),
                                    },
                                  ]
                                : []),
                              ...(sku.status !== 'ARCHIVED'
                                ? [
                                    {
                                      label: 'بایگانی',
                                      onSelect: () => setConfirm({ type: 'archive', sku }),
                                      danger: true,
                                    },
                                  ]
                                : []),
                            ]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {meta && meta.total > meta.pageSize ? (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>
            صفحه {page} از {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              قبلی
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              بعدی
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen} title="SKU جدید">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          {!hasVariantOptions ? (
            <p className="text-sm text-slate-600">
              این محصول ویژگی تنوع ندارد؛ فقط یک SKU ساده می‌توانید ثبت کنید.
            </p>
          ) : null}
          {hasVariantOptions
            ? sortedVariantOptions.map((option) => (
                <div key={option.id} className="space-y-1">
                  <Label htmlFor={`create-opt-${option.id}`}>{option.name}</Label>
                  <select
                    id={`create-opt-${option.id}`}
                    className={selectClassName}
                    value={createSelections[option.id] ?? ''}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setCreateSelections((prev) => {
                        const next = { ...prev, [option.id]: nextValue };
                        if (sortedVariantOptions.length === 1 && productCode) {
                          setCreateCode(suggestCreateCode(next, sortedVariantOptions));
                        }
                        return next;
                      });
                    }}
                    required
                  >
                    <option value="">انتخاب کنید</option>
                    {option.values
                      .filter((value) => value.isActive)
                      .map((value) => (
                        <option key={value.id} value={value.id}>
                          {value.value}
                        </option>
                      ))}
                  </select>
                </div>
              ))
            : null}
          <div className="space-y-1">
            <Label htmlFor="create-sku-code">کد SKU</Label>
            <Input
              id="create-sku-code"
              value={createCode}
              onChange={(event) => setCreateCode(event.target.value.toUpperCase())}
              required
              maxLength={64}
              placeholder="مثلاً FAN-SL-01"
            />
            <p className="text-xs text-slate-500">فقط حروف بزرگ انگلیسی، اعداد و . _ -</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="create-sku-name">نام (اختیاری)</Label>
            <Input
              id="create-sku-name"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              maxLength={200}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !createValid}>
              {createMutation.isPending ? 'در حال ذخیره...' : 'ایجاد'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={bulkOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBulkOpen(false);
            setBulkRows([]);
          }
        }}
        title="تولید گروهی SKU"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {bulkRows.length} ترکیب جدید (حداکثر {VARIANT_GENERATION_MAX} در هر بار). ترکیب‌های
            موجود نادیده گرفته شده‌اند.
          </p>
          <div className="max-h-[360px] overflow-x-auto overflow-y-auto rounded-md border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-right text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">کد</th>
                  <th className="px-3 py-2 font-medium">نام</th>
                  <th className="px-3 py-2 font-medium">تنوع</th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, index) => (
                  <tr key={row.optionValueIds.join('-')} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Input
                        value={row.code}
                        onChange={(event) => {
                          const code = event.target.value.toUpperCase();
                          setBulkRows((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, code } : item)),
                          );
                        }}
                        maxLength={64}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={row.name}
                        onChange={(event) => {
                          const name = event.target.value;
                          setBulkRows((prev) =>
                            prev.map((item, i) => (i === index ? { ...item, name } : item)),
                          );
                        }}
                        maxLength={200}
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-600">{row.variantLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>
              انصراف
            </Button>
            <Button
              type="button"
              disabled={bulkMutation.isPending || !bulkValid}
              onClick={() => bulkMutation.mutate()}
            >
              {bulkMutation.isPending ? 'در حال ایجاد...' : `ایجاد ${bulkRows.length} SKU`}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(editSku)}
        onOpenChange={(open) => {
          if (!open) {
            setEditSku(null);
            setVariantChangeConfirm(false);
          }
        }}
        title="ویرایش SKU"
      >
        {editSku ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitEdit();
            }}
          >
            {hasVariantOptions
              ? sortedVariantOptions.map((option) => (
                  <div key={option.id} className="space-y-1">
                    <Label htmlFor={`edit-opt-${option.id}`}>{option.name}</Label>
                    <select
                      id={`edit-opt-${option.id}`}
                      className={selectClassName}
                      value={editSelections[option.id] ?? ''}
                      onChange={(event) => {
                        setVariantChangeConfirm(false);
                        setEditSelections((prev) => ({
                          ...prev,
                          [option.id]: event.target.value,
                        }));
                      }}
                      required
                    >
                      {option.values.map((value) => (
                        <option key={value.id} value={value.id}>
                          {value.value}
                          {!value.isActive ? ' (غیرفعال)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              : null}
            {variantChangeConfirm ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                ترکیب تنوع SKU تغییر می‌کند. این عمل یک SKU جدید از نظر سیستم محسوب می‌شود و
                امضای قبلی دیگر استفاده نمی‌شود. ادامه می‌دهید؟
              </p>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="edit-sku-code">کد SKU</Label>
              <Input
                id="edit-sku-code"
                value={editCode}
                onChange={(event) => setEditCode(event.target.value.toUpperCase())}
                required
                maxLength={64}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-sku-name">نام</Label>
              <Input
                id="edit-sku-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                maxLength={200}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditSku(null);
                  setVariantChangeConfirm(false);
                }}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={updateMutation.isPending || !editValid}>
                {updateMutation.isPending
                  ? 'در حال ذخیره...'
                  : variantChangeConfirm
                    ? 'تأیید و ذخیره'
                    : 'ذخیره'}
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm?.type === 'archive'
            ? 'بایگانی SKU'
            : confirm?.type === 'deactivate'
              ? 'غیرفعال کردن SKU'
              : 'فعال‌سازی SKU'
        }
        description={
          confirm?.type === 'archive'
            ? 'SKU حذف نمی‌شود و سوابق آن برای عملیات و گزارش‌های آینده حفظ خواهد شد.'
            : confirm?.type === 'deactivate'
              ? 'SKU از فهرست‌های عملیاتی حذف می‌شود اما حذف دائمی نمی‌شود.'
              : 'SKU دوباره فعال می‌شود.'
        }
        target={confirm?.sku.code}
        confirmLabel={
          confirm?.type === 'archive'
            ? 'بایگانی'
            : confirm?.type === 'deactivate'
              ? 'غیرفعال کردن'
              : 'فعال‌سازی'
        }
        danger={confirm?.type === 'archive'}
        loading={lifecycleLoading}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.type === 'archive') {
            archiveMutation.mutate(confirm.sku.id);
          } else if (confirm.type === 'deactivate') {
            deactivateMutation.mutate(confirm.sku.id);
          } else {
            activateMutation.mutate(confirm.sku.id);
          }
        }}
      />
    </section>
  );
}
