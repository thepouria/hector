import type { Metadata } from 'next';
import { ProductDetailPageClient } from '@/features/catalog/product-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات محصول',
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductDetailPageClient productId={id} />;
}
