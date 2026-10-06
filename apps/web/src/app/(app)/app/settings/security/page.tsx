import type { Metadata } from 'next';
import { SecurityPageClient } from '@/features/security/security-page';

export const metadata: Metadata = {
  title: 'امنیت | Hector',
};

export default function SecuritySettingsPage() {
  return <SecurityPageClient />;
}
