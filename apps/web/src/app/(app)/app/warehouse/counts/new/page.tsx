import type { Metadata } from 'next';
import { CountCreatePageClient } from '@/features/warehouse/count-create-page';

export const metadata: Metadata = {
  title: 'شمارش جدید',
};

export default function Page() {
  return <CountCreatePageClient />;
}
