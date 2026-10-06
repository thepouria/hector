import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { PutawayDetailPageClient } from '@/features/warehouse/putaway-detail-page';

export const metadata: Metadata = {
  title: 'جایگذاری',
};

type PageProps = {
  params: Promise<{ putawayId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { putawayId } = await params;
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PutawayDetailPageClient putawayId={putawayId} />
    </Suspense>
  );
}
