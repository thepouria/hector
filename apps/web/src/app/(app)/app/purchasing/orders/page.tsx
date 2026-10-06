import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { PurchaseOrdersPageClient } from '@/features/purchasing/purchase-orders-page';

export const metadata: Metadata = {
  title: 'سفارش‌های خرید',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PurchaseOrdersPageClient />
    </Suspense>
  );
}
