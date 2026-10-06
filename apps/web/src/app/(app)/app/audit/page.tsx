import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuditPageClient } from '@/features/audit/audit-page';
import { PageSkeleton } from '@/components/feedback/states';

export const metadata: Metadata = {
  title: 'تاریخچه تغییرات',
};

export default function AuditPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuditPageClient />
    </Suspense>
  );
}
