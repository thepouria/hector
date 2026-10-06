import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { ExpensesListPageClient } from '@/features/finance/expenses-list-page';

export const metadata: Metadata = { title: 'هزینه‌ها' };

export default function FinanceExpensesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ExpensesListPageClient />
    </Suspense>
  );
}
