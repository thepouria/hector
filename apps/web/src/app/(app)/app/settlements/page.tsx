import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SettlementDashboardPage } from '@/features/settlement/settlement-dashboard-page';

export const metadata: Metadata = {
  title: 'مرکز تسویه',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettlementDashboardPage />
    </Suspense>
  );
}
