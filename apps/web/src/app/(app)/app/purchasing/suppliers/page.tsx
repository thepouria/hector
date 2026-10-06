import type { Metadata } from 'next';
import { SuppliersPageClient } from '@/features/purchasing/suppliers-page';

export const metadata: Metadata = {
  title: 'تأمین‌کنندگان',
};

export default function Page() {
  return <SuppliersPageClient />;
}
