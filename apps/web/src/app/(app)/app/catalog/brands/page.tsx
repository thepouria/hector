import type { Metadata } from 'next';
import { BrandsPageClient } from '@/features/catalog/brands-page';

export const metadata: Metadata = {
  title: 'برندها',
};

export default function Page() {
  return <BrandsPageClient />;
}
