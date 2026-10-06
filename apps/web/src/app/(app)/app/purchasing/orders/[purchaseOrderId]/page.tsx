import type { Metadata } from 'next';
import { PurchaseOrderDetailPageClient } from '@/features/purchasing/purchase-order-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات سفارش خرید',
};

type PageProps = {
  params: Promise<{ purchaseOrderId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { purchaseOrderId } = await params;
  return <PurchaseOrderDetailPageClient purchaseOrderId={purchaseOrderId} />;
}
