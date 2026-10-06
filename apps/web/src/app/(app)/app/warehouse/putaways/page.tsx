import type { Metadata } from 'next';
import { PutawaysPageClient } from '@/features/warehouse/putaways-page';

export const metadata: Metadata = {
  title: 'جایگذاری',
};

export default function Page() {
  return <PutawaysPageClient />;
}
