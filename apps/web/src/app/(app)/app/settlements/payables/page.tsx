import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { SettlementPayablesPage } from '@/features/settlement/settlement-payables-page';

export const metadata: Metadata = {
  title: 'بدهی تأمین‌کننده — تسویه',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettlementPayablesPage />
    </Suspense>
  );
}
