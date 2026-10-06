import { CapitalDetailPageClient } from '@/features/finance/capital-detail-page';

export default async function FinanceCapitalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CapitalDetailPageClient contributionId={id} />;
}
