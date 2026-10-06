import type { Metadata } from 'next';
import { TransferDetailPageClient } from '@/features/warehouse/transfer-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات انتقال',
};

type PageProps = {
  params: Promise<{ transferId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { transferId } = await params;
  return <TransferDetailPageClient transferId={transferId} />;
}
