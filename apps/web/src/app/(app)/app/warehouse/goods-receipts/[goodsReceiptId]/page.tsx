import type { Metadata } from 'next';
import { GoodsReceiptDetailPageClient } from '@/features/warehouse/goods-receipt-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات رسید کالا',
};

type PageProps = {
  params: Promise<{ goodsReceiptId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { goodsReceiptId } = await params;
  return <GoodsReceiptDetailPageClient goodsReceiptId={goodsReceiptId} />;
}
