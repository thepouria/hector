import type { Metadata } from 'next';
import { Vazirmatn } from 'next/font/google';
import { AppProviders } from '@/providers/app-providers';
import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  variable: '--font-vazirmatn',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Hector',
    template: '%s | Hector',
  },
  description: 'Hector Business Operating System',
};

/** Auth-gated ERP shell — never statically export pages. */
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
