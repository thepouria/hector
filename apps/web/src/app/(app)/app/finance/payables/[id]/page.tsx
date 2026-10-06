import { PayableDetailPageClient } from '@/features/finance/payable-detail-page';

export default async function FinancePayableDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PayableDetailPageClient payableId={id} />;
}
