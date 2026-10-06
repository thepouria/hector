import type { Metadata } from 'next';
import { SupplierDetailPageClient } from '@/features/purchasing/supplier-detail-page';

export const metadata: Metadata = {
  title: 'جزئیات تأمین‌کننده',
};

type PageProps = {
  params: Promise<{ supplierId: string }>;
};

export default async function Page({ params }: PageProps) {
  const { supplierId } = await params;
  return <SupplierDetailPageClient supplierId={supplierId} />;
}
