import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { InventoryMovementsPageClient } from '@/features/warehouse/inventory-movements-page';

export const metadata: Metadata = {
  title: 'حرکات انبار',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InventoryMovementsPageClient />
    </Suspense>
  );
}
