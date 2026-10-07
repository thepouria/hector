import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SettlementPayableDetailPage } from '@/features/settlement/settlement-payable-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات بدهی — تسویه',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettlementPayableDetailPage />
    </Suspense>
  );
}
