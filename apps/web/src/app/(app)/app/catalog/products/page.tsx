import type { Metadata } from 'next';
import { ProductsPageClient } from '@/features/catalog/products-page';

export const metadata: Metadata = {
  title: 'محصولات',
};

export default function Page() {
  return <ProductsPageClient />;
}
