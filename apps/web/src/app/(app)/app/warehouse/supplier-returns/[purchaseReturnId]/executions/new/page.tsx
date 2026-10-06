import type { Metadata } from 'next';
import { SupplierReturnExecutionCreatePageClient } from '@/features/warehouse/supplier-return-execution-create-page';

export const metadata: Metadata = {
  title: 'اجرای برگشت جدید',
};

type Props = { params: Promise<{ purchaseReturnId: string }> };

export default async function Page({ params }: Props) {
  const { purchaseReturnId } = await params;
  return <SupplierReturnExecutionCreatePageClient purchaseReturnId={purchaseReturnId} />;
}
