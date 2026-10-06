import type { Metadata } from 'next';
import { OffersPageClient } from '@/features/purchasing/offers-page';

export const metadata: Metadata = {
  title: 'استعلام قیمت',
};

export default function Page() {
  return <OffersPageClient />;
}
