import type { Metadata } from 'next';
import { AttributesPageClient } from '@/features/catalog/attributes-page';

export const metadata: Metadata = {
  title: 'ویژگی‌های اطلاعاتی',
};

export default function Page() {
  return <AttributesPageClient />;
}
