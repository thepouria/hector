import type { Metadata } from 'next';
import { RolesPageClient } from '@/features/roles/roles-page';

export const metadata: Metadata = {
  title: 'نقش‌ها و دسترسی‌ها | Hector',
};

export default function RolesSettingsPage() {
  return <RolesPageClient />;
}
