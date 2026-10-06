import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { FinanceDashboardPage } from '@/features/finance/finance-dashboard-page';

export const metadata: Metadata = {
  title: 'داشبورد مالی',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FinanceDashboardPage />
    </Suspense>
  );
}
