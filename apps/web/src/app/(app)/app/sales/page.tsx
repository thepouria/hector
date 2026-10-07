import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SalesDashboardPage } from '@/features/sales/sales-dashboard-page';

export const metadata: Metadata = {
  title: 'داشبورد فروش',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesDashboardPage />
    </Suspense>
  );
}
