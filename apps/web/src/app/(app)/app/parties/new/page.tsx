import type { Metadata } from 'next';
import { PartyCreatePage } from '@/features/party/party-create-page';

export const metadata: Metadata = {
  title: 'شخص جدید',
};

export default function Page() {
  return <PartyCreatePage />;
}
