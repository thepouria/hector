import { ReceiptDetailPageClient } from '@/features/finance/receipt-detail-page';

export default async function FinanceReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReceiptDetailPageClient receiptId={id} />;
}
