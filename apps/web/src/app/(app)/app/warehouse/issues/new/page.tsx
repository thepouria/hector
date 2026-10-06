import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { IssueCreatePageClient } from '@/features/warehouse/issue-create-page';

export const metadata: Metadata = {
  title: 'خروج جدید',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <IssueCreatePageClient />
    </Suspense>
  );
}
