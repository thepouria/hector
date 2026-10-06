import type { Metadata } from 'next';
import { CompanySettingsPageClient } from '@/features/settings/company-settings-page';

export const metadata: Metadata = {
  title: 'تنظیمات شرکت | Hector',
};

export default function CompanySettingsPage() {
  return <CompanySettingsPageClient />;
}
