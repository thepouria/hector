import type { Metadata } from 'next';
import { FxConversionsPageClient } from '@/features/finance/fx-conversions-page';

export const metadata: Metadata = { title: 'تبدیل ارز' };

export default function Page() {
  return <FxConversionsPageClient />;
}
