import type { Metadata } from 'next';
import { OfferDetailPageClient } from '@/features/purchasing/offer-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات استعلام قیمت',
};

type PageProps = {
  params: Promise<{ offerId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { offerId } = await params;
  return <OfferDetailPageClient offerId={offerId} />;
}
