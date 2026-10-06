import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { OfferComparePageClient } from '@/features/purchasing/offer-compare-page';

export const metadata: Metadata = {
  title: 'مقایسه قیمت',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OfferComparePageClient />
    </Suspense>
  );
}
