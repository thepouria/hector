import type { Metadata } from 'next';
import { LedgerAccountsPageClient } from '@/features/finance/ledger-accounts-page';

export const metadata: Metadata = { title: 'حساب‌های دفتر' };

export default function Page() {
  return <LedgerAccountsPageClient />;
}
