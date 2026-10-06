import { ExpenseDetailPageClient } from '@/features/finance/expense-detail-page';

export default async function FinanceExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExpenseDetailPageClient expenseId={id} />;
}
