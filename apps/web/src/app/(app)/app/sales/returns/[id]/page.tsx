import type { Metadata } from 'next';
import { SalesReturnDetailPage } from '@/features/sales/sales-return-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات برگشت فروش',
};

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SalesReturnDetailPage returnId={id} />;
}
