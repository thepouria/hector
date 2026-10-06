import type { Metadata } from 'next';
import { JournalsListPageClient } from '@/features/finance/journals-list-page';

export const metadata: Metadata = { title: 'اسناد روزنامه' };

export default function Page() {
  return <JournalsListPageClient />;
}
