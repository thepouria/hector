import type { Metadata } from 'next';
import { MembersPageClient } from '@/features/members/members-page';

export const metadata: Metadata = {
  title: 'اعضا | Hector',
};

export default function MembersSettingsPage() {
  return <MembersPageClient />;
}
