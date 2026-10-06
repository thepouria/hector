import { AppGate } from '@/components/layout/app-gate';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppGate>{children}</AppGate>;
}
