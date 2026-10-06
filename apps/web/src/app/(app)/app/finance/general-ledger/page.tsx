import type { Metadata } from 'next';
import { GeneralLedgerPageClient } from '@/features/finance/general-ledger-page';

export const metadata: Metadata = { title: 'دفتر کل' };

export default function Page() {
  return <GeneralLedgerPageClient />;
}
