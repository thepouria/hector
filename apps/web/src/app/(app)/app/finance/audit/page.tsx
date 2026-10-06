import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { FinanceAuditPageClient } from '@/features/finance/finance-audit-page';

export const metadata: Metadata = {
  title: 'حسابرسی مالی',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FinanceAuditPageClient />
    </Suspense>
  );
}
