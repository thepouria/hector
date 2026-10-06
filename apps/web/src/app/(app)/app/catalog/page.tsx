import type { Metadata } from 'next';
import { CatalogLandingPage } from '@/features/catalog/catalog-landing-page';

export const metadata: Metadata = {
  title: 'کاتالوگ',
};

export default function Page() {
  return <CatalogLandingPage />;
}
