import type { Metadata } from 'next';
import { SupplierReturnDetailPageClient } from '@/features/warehouse/supplier-return-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات برگشت تأمین‌کننده',
};

type Props = { params: Promise<{ purchaseReturnId: string }> };

export default async function Page({ params }: Props) {
  const { purchaseReturnId } = await params;
  return <SupplierReturnDetailPageClient purchaseReturnId={purchaseReturnId} />;
}
