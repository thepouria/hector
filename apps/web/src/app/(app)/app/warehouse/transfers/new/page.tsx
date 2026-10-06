import type { Metadata } from 'next';
import { TransferCreatePageClient } from '@/features/warehouse/transfer-create-page';

export const metadata: Metadata = {
  title: 'انتقال جدید',
};

export default function Page() {
  return <TransferCreatePageClient />;
}
