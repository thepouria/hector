import type { Metadata } from 'next';
import { JournalDetailPageClient } from '@/features/finance/journal-detail-page';

export const metadata: Metadata = { title: 'جزئیات سند روزنامه' };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <JournalDetailPageClient journalId={id} />;
}
