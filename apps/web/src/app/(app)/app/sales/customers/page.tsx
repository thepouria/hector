import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SalesCustomersPage } from '@/features/sales/sales-customers-page';

export const metadata: Metadata = {
  title: 'مشتریان',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesCustomersPage />
    </Suspense>
  );
}
