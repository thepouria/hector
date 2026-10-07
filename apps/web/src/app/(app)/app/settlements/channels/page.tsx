import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/feedback/states';
import { ChannelSettlementsPage } from '@/features/settlement/channel-settlements-page';

export const metadata: Metadata = {
  title: 'تسویه کانال',
};

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChannelSettlementsPage />
    </Suspense>
  );
}
