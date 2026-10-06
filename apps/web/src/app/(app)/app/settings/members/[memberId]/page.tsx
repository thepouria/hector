import type { Metadata } from 'next';
import { MemberDetailPageClient } from '@/features/members/member-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات عضو | Hector',
};

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  return <MemberDetailPageClient memberId={memberId} />;
}
