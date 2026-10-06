import type { Metadata } from 'next';
import { GoodsReceiptsPageClient } from '@/features/warehouse/goods-receipts-page';

export const metadata: Metadata = {
  title: 'رسید کالا',
};

export default function Page() {
  return <GoodsReceiptsPageClient />;
}
