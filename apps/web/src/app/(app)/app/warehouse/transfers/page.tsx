import type { Metadata } from 'next';
import { TransfersPageClient } from '@/features/warehouse/transfers-page';

export const metadata: Metadata = {
  title: 'انتقال داخلی',
};

export default function Page() {
  return <TransfersPageClient />;
}
