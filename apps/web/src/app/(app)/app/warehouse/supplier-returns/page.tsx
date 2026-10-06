import type { Metadata } from 'next';
import { SupplierReturnsPageClient } from '@/features/warehouse/supplier-returns-page';

export const metadata: Metadata = {
  title: 'برگشت به تأمین‌کننده',
};

export default function Page() {
  return <SupplierReturnsPageClient />;
}
