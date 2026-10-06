import type { Metadata } from 'next';
import { AttributeDetailPageClient } from '@/features/catalog/attribute-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات ویژگی',
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  return <AttributeDetailPageClient attributeId={id} />;
}
