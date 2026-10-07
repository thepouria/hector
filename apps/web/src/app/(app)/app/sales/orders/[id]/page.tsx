import type { Metadata } from 'next';
import { SalesOrderDetailPage } from '@/features/sales/sales-order-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات سفارش فروش',
};

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SalesOrderDetailPage orderId={id} />;
}
