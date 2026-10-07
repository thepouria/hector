import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SalesReturnsPage } from '@/features/sales/sales-returns-page';

export const metadata: Metadata = {
  title: 'برگشت از مشتری',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SalesReturnsPage />
    </Suspense>
  );
}
