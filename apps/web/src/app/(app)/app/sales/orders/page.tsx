import type { Metadata } from 'next';
import { SalesOrdersPage } from '@/features/sales/sales-orders-page';

export const metadata: Metadata = {
  title: 'سفارش‌های فروش',
};

export default function Page() {
  return <SalesOrdersPage />;
}
