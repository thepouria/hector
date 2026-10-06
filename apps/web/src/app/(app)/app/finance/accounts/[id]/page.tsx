import type { Metadata } from 'next';
import { FinanceAccountDetailPageClient } from '@/features/finance/account-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات حساب',
};

export default function Page() {
  return <FinanceAccountDetailPageClient />;
}
