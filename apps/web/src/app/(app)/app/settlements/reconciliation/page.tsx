import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { ReconciliationListPage } from '@/features/settlement/reconciliation-list-page';

export const metadata: Metadata = {
  title: 'مغایرت‌گیری',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReconciliationListPage />
    </Suspense>
  );
}
