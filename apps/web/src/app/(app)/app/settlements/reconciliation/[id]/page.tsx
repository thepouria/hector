import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { ReconciliationDetailPage } from '@/features/settlement/reconciliation-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات مغایرت‌گیری',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReconciliationDetailPage />
    </Suspense>
  );
}
