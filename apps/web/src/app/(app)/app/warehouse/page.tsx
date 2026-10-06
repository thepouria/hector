import type { Metadata } from 'next';
import { WarehousesPageClient } from '@/features/warehouse/warehouses-page';

export const metadata: Metadata = {
  title: 'انبارها',
};

export default function Page() {
  return <WarehousesPageClient />;
}
