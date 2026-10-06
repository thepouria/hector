import type { Metadata } from 'next';
import { FxRatesPageClient } from '@/features/finance/fx-rates-page';

export const metadata: Metadata = { title: 'نرخ‌های ارز' };

export default function Page() {
  return <FxRatesPageClient />;
}
