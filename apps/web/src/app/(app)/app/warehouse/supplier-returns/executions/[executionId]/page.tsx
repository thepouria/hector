import type { Metadata } from 'next';
import { SupplierReturnExecutionDetailPageClient } from '@/features/warehouse/supplier-return-execution-detail-page';

export const metadata: Metadata = {
  title: 'اجرای برگشت تأمین‌کننده',
};

type Props = { params: Promise<{ executionId: string }> };

export default async function Page({ params }: Props) {
  const { executionId } = await params;
  return <SupplierReturnExecutionDetailPageClient executionId={executionId} />;
}
