import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SettlementLoansPage } from '@/features/settlement/settlement-loans-page';

export const metadata: Metadata = {
  title: 'وام‌ها — تسویه',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettlementLoansPage />
    </Suspense>
  );
}
