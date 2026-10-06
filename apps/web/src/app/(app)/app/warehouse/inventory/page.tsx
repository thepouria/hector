import type { Metadata } from 'next';
import { InventoryPageClient } from '@/features/warehouse/inventory-page';

export const metadata: Metadata = {
  title: 'موجودی فیزیکی',
};

export default function Page() {
  return <InventoryPageClient />;
}
