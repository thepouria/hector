import type { Metadata } from 'next';
import { CategoriesPageClient } from '@/features/catalog/categories-page';

export const metadata: Metadata = {
  title: 'دسته‌بندی‌ها',
};

export default function Page() {
  return <CategoriesPageClient />;
}
