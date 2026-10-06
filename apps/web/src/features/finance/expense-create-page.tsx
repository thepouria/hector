'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AccessDenied, ErrorState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { createExpense, fetchExpenseCategories } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeExpenseKeys } from '@/lib/query/keys';
import { financeExpensePath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import { useState } from 'react';

export function ExpenseCreatePageClient() {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.FINANCE_EXPENSES_MANAGE);

  const categoriesQuery = useQuery({
    queryKey: financeExpenseKeys.categories(companyId),
    queryFn: () => fetchExpenseCategories(companyId),
    enabled: Boolean(companyId) && canManage,
  });

  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [approveImmediately, setApproveImmediately] = useState(true);

  const createMutation = useMutation({
    mutationFn: () =>
      createExpense(companyId, {
        categoryId,
        amount,
        currency: 'IRR',
        expenseDate: new Date().toISOString(),
        description,
        approveImmediately,
        requestId: crypto.randomUUID(),
      }),
    onSuccess: (data) => router.push(financeExpensePath(data.id)),
  });

  if (!canManage) return <AccessDenied />;
  if (categoriesQuery.isError) {
    if (isApiClientError(categoriesQuery.error) && categoriesQuery.error.status === 401) {
      handleUnauthorized();
    }
    return <ErrorState message="بارگذاری دسته‌ها ناموفق بود." onRetry={() => categoriesQuery.refetch()} />;
  }

  return (
    <div className="mx-auto max-w-lg space-y-6" dir="rtl">
      <PageHeader title="هزینه جدید" description="تأیید هزینه حرکت حساب ایجاد نمی‌کند." />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
      >
        <label className="block space-y-1 text-sm">
          <span>دسته</span>
          <select
            className="w-full rounded border px-3 py-2"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
          >
            <option value="">انتخاب…</option>
            {categoriesQuery.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>مبلغ (ریال)</span>
          <input
            className="w-full rounded border px-3 py-2 tabular-nums"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>شرح</span>
          <input
            className="w-full rounded border px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={approveImmediately}
            onChange={(e) => setApproveImmediately(e.target.checked)}
          />
          تأیید فوری
        </label>
        {createMutation.isError ? (
          <p className="text-sm text-red-600">ثبت هزینه ناموفق بود.</p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={createMutation.isPending}>
            ثبت
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(ROUTES.financeExpenses)}>
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
