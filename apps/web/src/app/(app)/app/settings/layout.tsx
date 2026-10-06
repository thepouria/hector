import { SettingsLayout } from '@/components/settings/settings-layout';

export default function SettingsRootLayout({ children }: { children: React.ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
