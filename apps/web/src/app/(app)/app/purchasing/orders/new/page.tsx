import type { Metadata } from 'next';
import { PurchaseOrderCreatePageClient } from '@/features/purchasing/purchase-order-create-page';

export const metadata: Metadata = {
  title: 'سفارش خرید جدید',
};

export default function Page() {
  return <PurchaseOrderCreatePageClient />;
}
