import type { Metadata } from 'next';
import { AdjustmentCreatePageClient } from '@/features/warehouse/adjustment-create-page';

export const metadata: Metadata = {
  title: 'تعدیل جدید',
};

export default function Page() {
  return <AdjustmentCreatePageClient />;
}
