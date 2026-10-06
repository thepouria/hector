import type { Metadata } from 'next';
import { TrialBalancePageClient } from '@/features/finance/trial-balance-page';

export const metadata: Metadata = { title: 'تراز آزمایشی' };

export default function Page() {
  return <TrialBalancePageClient />;
}
