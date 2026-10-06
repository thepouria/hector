import type { Metadata } from 'next';
import { AdjustmentDetailPageClient } from '@/features/warehouse/adjustment-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات تعدیل',
};

type PageProps = {
  params: Promise<{ adjustmentId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { adjustmentId } = await params;
  return <AdjustmentDetailPageClient adjustmentId={adjustmentId} />;
}
