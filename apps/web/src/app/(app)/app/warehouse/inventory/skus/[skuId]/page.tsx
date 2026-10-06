import type { Metadata } from 'next';
import { InventorySkuPageClient } from '@/features/warehouse/inventory-sku-page';

export const metadata: Metadata = {
  title: 'موجودی SKU',
};

export default async function Page({
  params,
}: {
  params: Promise<{ skuId: string }>;
}) {
  const { skuId } = await params;
  return <InventorySkuPageClient skuId={skuId} />;
}
