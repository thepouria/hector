import type { Metadata } from 'next';
import { CountsPageClient } from '@/features/warehouse/counts-page';

export const metadata: Metadata = {
  title: 'شمارش موجودی',
};

export default function Page() {
  return <CountsPageClient />;
}
