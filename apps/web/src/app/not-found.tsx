import Link from 'next/link';
import { ROUTES } from '@/lib/utils/routes';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <h1 className="text-2xl font-semibold">صفحه پیدا نشد</h1>
      <p className="text-sm text-slate-500">مسیر درخواستی وجود ندارد.</p>
      <Link href={ROUTES.dashboard} className="text-sm font-medium text-slate-900 underline">
        بازگشت به داشبورد
      </Link>
    </main>
  );
}
