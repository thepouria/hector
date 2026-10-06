import type { Metadata } from 'next';
import { CountDetailPageClient } from '@/features/warehouse/count-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات شمارش',
};

type PageProps = {
  params: Promise<{ countId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { countId } = await params;
  return <CountDetailPageClient countId={countId} />;
}
