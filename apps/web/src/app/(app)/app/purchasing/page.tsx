import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { PurchasingLandingPage } from '@/features/purchasing/purchasing-landing-page';

export const metadata: Metadata = {
  title: 'داشبورد خرید',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PurchasingLandingPage />
    </Suspense>
  );
}
