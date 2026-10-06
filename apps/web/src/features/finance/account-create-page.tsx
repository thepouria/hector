'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createFinancialAccount, recordOpeningBalance } from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { financeAccountKeys } from '@/lib/query/keys';
import { financeAccountPath, ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

export function FinanceAccountCreatePageClient() {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.FINANCE_ACCOUNTS_MANAGE);

  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState('CASH');
  const [currency, setCurrency] = React.useState('IRR');
  const [isDefault, setIsDefault] = React.useState(false);
  const [bankName, setBankName] = React.useState('');
  const [accountNumber, setAccountNumber] = React.useState('');
  const [iban, setIban] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [openingAmount, setOpeningAmount] = React.useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const account = await createFinancialAccount(companyId, {
        code,
        name,
        type,
        currency,
        isDefault: isDefault || undefined,
        bankName: bankName || undefined,
        accountNumber: accountNumber || undefined,
        iban: iban || undefined,
        description: description || undefined,
      });
      if (openingAmount.trim()) {
        await recordOpeningBalance(companyId, account.id, {
          amount: openingAmount.trim(),
          requestId: crypto.randomUUID(),
          description: 'موجودی افتتاحیه',
        });
      }
      return account;
    },
    onSuccess: async (account) => {
      await queryClient.invalidateQueries({ queryKey: financeAccountKeys.all(companyId) });
      toast.success('حساب ایجاد شد');
      router.push(financeAccountPath(account.id));
    },
    onError: (error) => {
      if (isApiClientError(error) && error.status === 401) {
        handleUnauthorized();
        return;
      }
      toast.error(mapBusinessError(error));
    },
  });

  if (!canManage) {
    return <AccessDenied />;
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="حساب مالی جدید"
        description="ارز پس از ایجاد قابل تغییر نیست. موجودی افتتاحیه درآمد نیست."
      />

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="code">کد *</Label>
          <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">نام *</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="type">نوع *</Label>
            <select
              id="type"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="CASH">صندوق</option>
              <option value="BANK">بانک</option>
              <option value="WALLET">کیف پول</option>
              <option value="OTHER">سایر</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="currency">ارز *</Label>
            <select
              id="currency"
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option value="IRR">IRR</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        {type === 'BANK' ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="bankName">نام بانک</Label>
              <Input
                id="bankName"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="accountNumber">شماره حساب</Label>
              <Input
                id="accountNumber"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="iban">شبا (IBAN)</Label>
              <Input id="iban" value={iban} onChange={(e) => setIban(e.target.value)} />
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="opening">موجودی افتتاحیه (اختیاری)</Label>
          <Input
            id="opening"
            value={openingAmount}
            onChange={(e) => setOpeningAmount(e.target.value)}
            placeholder={currency === 'IRR' ? 'مثال: 2000000000' : 'مثال: 10000'}
            dir="ltr"
            className="tabular-nums"
          />
          <p className="text-xs text-slate-500">
            موجودی افتتاحیه نشان‌دهنده پول از قبل موجود است — نه درآمد.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">توضیحات</Label>
          <Input
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          پیش‌فرض این ارز
        </label>

        <div className="flex gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            ذخیره
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(ROUTES.financeAccounts)}>
            انصراف
          </Button>
        </div>
      </form>
    </div>
  );
}
