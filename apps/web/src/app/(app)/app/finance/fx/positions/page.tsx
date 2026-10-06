import type { Metadata } from 'next';
import { FxPositionsPageClient } from '@/features/finance/fx-positions-page';

export const metadata: Metadata = { title: 'موقعیت ارزی' };

export default function Page() {
  return <FxPositionsPageClient />;
}
