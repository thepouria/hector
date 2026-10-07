import type { Metadata } from 'next';
import { SalesOrderCreatePage } from '@/features/sales/sales-order-create-page';

export const metadata: Metadata = {
  title: 'سفارش فروش جدید',
};

export default function Page() {
  return <SalesOrderCreatePage />;
}
