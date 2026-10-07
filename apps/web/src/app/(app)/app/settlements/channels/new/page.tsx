import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { ChannelSettlementCreatePage } from '@/features/settlement/channel-settlement-create-page';

export const metadata: Metadata = {
  title: 'ایجاد تسویه کانال',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChannelSettlementCreatePage />
    </Suspense>
  );
}
