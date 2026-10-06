import type { Metadata } from 'next';
import { FxConversionCreatePageClient } from '@/features/finance/fx-conversion-create-page';

export const metadata: Metadata = { title: 'تبدیل جدید' };

export default function Page() {
  return <FxConversionCreatePageClient />;
}
