import type { Metadata } from 'next';
import { InventoryMovementDetailPageClient } from '@/features/warehouse/inventory-movement-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات حرکت انبار',
};

type PageProps = {
  params: Promise<{ movementId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { movementId } = await params;
  return <InventoryMovementDetailPageClient movementId={movementId} />;
}
