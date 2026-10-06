import type { Metadata } from 'next';
import { BatchesPageClient } from '@/features/warehouse/batches-page';

export const metadata: Metadata = {
  title: 'بچ / سری ساخت',
};

export default function Page() {
  return <BatchesPageClient />;
}
