import type { Metadata } from 'next';
import { BatchDetailPageClient } from '@/features/warehouse/batch-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات بچ',
};

type Props = {
  params: Promise<{ batchId: string }>;
};

export default async function Page({ params }: Props) {
  const { batchId } = await params;
  return <BatchDetailPageClient batchId={batchId} />;
}
