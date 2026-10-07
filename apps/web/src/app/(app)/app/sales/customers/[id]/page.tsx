import type { Metadata } from 'next';
import { SalesCustomerDetailPage } from '@/features/sales/sales-customer-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات مشتری',
};

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SalesCustomerDetailPage customerId={id} />;
}
