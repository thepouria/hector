import type { Metadata } from 'next';
import { RoleDetailPageClient } from '@/features/roles/role-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات نقش | Hector',
};

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  return <RoleDetailPageClient roleId={roleId} />;
}
