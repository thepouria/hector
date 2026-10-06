import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { PurchaseReturnCreatePage } from '@/features/purchasing/purchase-return-create-page';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PurchaseReturnCreatePage />
    </Suspense>
  );
}
