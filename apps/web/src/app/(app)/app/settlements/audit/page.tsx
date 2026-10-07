import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SettlementAuditPage } from '@/features/settlement/settlement-audit-page';

export const metadata: Metadata = {
  title: 'تاریخچه تسویه',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettlementAuditPage />
    </Suspense>
  );
}
