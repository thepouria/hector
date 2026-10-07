import type { Metadata } from 'next';
import { PartyDetailPage } from '@/features/party/party-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات شخص',
};

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PartyDetailPage partyId={id} />;
}
