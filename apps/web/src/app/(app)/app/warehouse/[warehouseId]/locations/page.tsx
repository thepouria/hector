import type { Metadata } from 'next';
import { WarehouseLocationsPageClient } from '@/features/warehouse/warehouse-locations-page';

export const metadata: Metadata = {
  title: 'مکان‌های انبار',
};

export default async function Page({
  params,
}: {
  params: Promise<{ warehouseId: string }>;
}) {
  const { warehouseId } = await params;
  return <WarehouseLocationsPageClient warehouseId={warehouseId} />;
}
