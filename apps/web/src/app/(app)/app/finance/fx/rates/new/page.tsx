import type { Metadata } from 'next';
import { FxRateCreatePageClient } from '@/features/finance/fx-rate-create-page';

export const metadata: Metadata = { title: 'نرخ جدید' };

export default function Page() {
  return <FxRateCreatePageClient />;
}
