import type { Metadata } from 'next';
import { PartiesPage } from '@/features/party/parties-page';

export const metadata: Metadata = {
  title: 'اشخاص',
};

export default function Page() {
  return <PartiesPage />;
}
