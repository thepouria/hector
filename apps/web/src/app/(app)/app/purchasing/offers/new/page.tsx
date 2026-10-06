import type { Metadata } from 'next';
import { OfferCreatePageClient } from '@/features/purchasing/offer-create-page';

export const metadata: Metadata = {
  title: 'ثبت استعلام قیمت',
};

export default function Page() {
  return <OfferCreatePageClient />;
}
