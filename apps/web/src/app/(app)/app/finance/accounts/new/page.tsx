import type { Metadata } from 'next';
import { FinanceAccountCreatePageClient } from '@/features/finance/account-create-page';

export const metadata: Metadata = {
  title: 'حساب جدید',
};

export default function Page() {
  return <FinanceAccountCreatePageClient />;
}
