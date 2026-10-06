import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { PurchaseReturnsPage } from '@/features/purchasing/purchase-returns-page';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PurchaseReturnsPage />
    </Suspense>
  );
}
