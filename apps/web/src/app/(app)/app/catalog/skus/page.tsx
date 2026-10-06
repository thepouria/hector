import type { Metadata } from 'next';
import { SkusPageClient } from '@/features/catalog/skus-page';

export const metadata: Metadata = {
  title: 'SKUها',
};

export default function Page() {
  return <SkusPageClient />;
}
