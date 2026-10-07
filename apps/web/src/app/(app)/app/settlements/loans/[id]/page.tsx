import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SettlementLoanDetailPage } from '@/features/settlement/settlement-loan-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات وام — تسویه',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettlementLoanDetailPage />
    </Suspense>
  );
}
