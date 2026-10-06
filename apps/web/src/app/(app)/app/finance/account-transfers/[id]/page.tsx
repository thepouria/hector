import { AccountTransferDetailPageClient } from '@/features/finance/account-transfer-detail-page';

export default async function FinanceAccountTransferDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AccountTransferDetailPageClient transferId={id} />;
}
