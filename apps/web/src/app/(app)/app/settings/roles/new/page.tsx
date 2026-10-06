import type { Metadata } from 'next';
import { RoleCreatePageClient } from '@/features/roles/role-create-page';

export const metadata: Metadata = {
  title: 'ایجاد نقش | Hector',
};

export default function RoleCreatePage() {
  return <RoleCreatePageClient />;
}
