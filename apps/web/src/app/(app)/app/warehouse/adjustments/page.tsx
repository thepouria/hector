import type { Metadata } from 'next';
import { AdjustmentsPageClient } from '@/features/warehouse/adjustments-page';

export const metadata: Metadata = {
  title: 'تعدیل موجودی',
};

export default function Page() {
  return <AdjustmentsPageClient />;
}
