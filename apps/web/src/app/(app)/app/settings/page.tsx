import type { Metadata } from 'next';
import { SettingsOverviewPage } from '@/features/settings/settings-overview';

export const metadata: Metadata = {
  title: 'تنظیمات | Hector',
};

export default function SettingsPage() {
  return <SettingsOverviewPage />;
}
