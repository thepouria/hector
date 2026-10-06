import type { Metadata } from 'next';
import { GoodsReceiptCreatePageClient } from '@/features/warehouse/goods-receipt-create-page';

export const metadata: Metadata = {
  title: 'رسید کالای جدید',
};

export default function Page() {
  return <GoodsReceiptCreatePageClient />;
}
