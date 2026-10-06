import { LoanDetailPageClient } from '@/features/finance/loan-detail-page';

export default async function FinanceLoanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LoanDetailPageClient loanId={id} />;
}
