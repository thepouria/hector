import type { Metadata } from 'next';
import { FxConversionDetailPageClient } from '@/features/finance/fx-conversion-detail-page';

export const metadata: Metadata = { title: 'جزئیات تبدیل' };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <FxConversionDetailPageClient conversionId={id} />;
}
