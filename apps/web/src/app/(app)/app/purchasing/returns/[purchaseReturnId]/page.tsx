import { PurchaseReturnDetailPage } from '@/features/purchasing/purchase-return-detail-page';

export default async function Page({
  params,
}: {
  params: Promise<{ purchaseReturnId: string }>;
}) {
  const { purchaseReturnId } = await params;
  return <PurchaseReturnDetailPage purchaseReturnId={purchaseReturnId} />;
}
