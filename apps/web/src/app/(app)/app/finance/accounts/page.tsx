import type { Metadata } from 'next';
import { FinanceAccountsPageClient } from '@/features/finance/accounts-page';

export const metadata: Metadata = {
  title: 'حساب‌های مالی',
};

export default function Page() {
  return <FinanceAccountsPageClient />;
}
