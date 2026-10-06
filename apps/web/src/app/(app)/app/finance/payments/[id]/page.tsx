import { PaymentDetailPageClient } from '@/features/finance/payment-detail-page';

export default async function FinancePaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PaymentDetailPageClient paymentId={id} />;
}
