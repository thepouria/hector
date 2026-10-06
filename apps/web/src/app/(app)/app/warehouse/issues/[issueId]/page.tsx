import type { Metadata } from 'next';
import { IssueDetailPageClient } from '@/features/warehouse/issue-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات خروج',
};

export default async function Page({
  params,
}: {
  params: Promise<{ issueId: string }>;
}) {
  const { issueId } = await params;
  return <IssueDetailPageClient issueId={issueId} />;
}
