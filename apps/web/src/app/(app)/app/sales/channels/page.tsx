import type { Metadata } from 'next';
import { SalesChannelsPage } from '@/features/sales/sales-channels-page';

export const metadata: Metadata = {
  title: 'کانال‌های فروش',
};

export default function Page() {
  return <SalesChannelsPage />;
}
