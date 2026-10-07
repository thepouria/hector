import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { ChannelSettlementDetailPage } from '@/features/settlement/channel-settlement-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات تسویه کانال',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChannelSettlementDetailPage />
    </Suspense>
  );
}
