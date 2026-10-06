import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';

export const metadata: Metadata = {
  title: 'مالی',
};

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="مالی"
        description="حساب‌ها، سرمایه، وام، بدهی، ارز، پرداخت، دریافت و انتقال — موجودی از دفتر حرکات مشتق می‌شود."
      />
      <div className="flex flex-wrap gap-3">
        <Link href={ROUTES.financeAccounts} className={cn(buttonVariants())}>
          حساب‌ها
        </Link>
        <Link href={ROUTES.financeCapital} className={cn(buttonVariants({ variant: 'outline' }))}>
          سرمایه
        </Link>
        <Link href={ROUTES.financeLoans} className={cn(buttonVariants({ variant: 'outline' }))}>
          وام‌ها
        </Link>
        <Link href={ROUTES.financePayables} className={cn(buttonVariants({ variant: 'outline' }))}>
          حساب‌های پرداختنی
        </Link>
        <Link href={ROUTES.financeFx} className={cn(buttonVariants({ variant: 'outline' }))}>
          ارز / FX
        </Link>
        <Link href={ROUTES.financePayments} className={cn(buttonVariants({ variant: 'outline' }))}>
          پرداخت‌ها
        </Link>
        <Link href={ROUTES.financeReceipts} className={cn(buttonVariants({ variant: 'outline' }))}>
          دریافت‌ها
        </Link>
        <Link
          href={ROUTES.financeAccountTransfers}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          انتقال‌ها
        </Link>
      </div>
      <p className="text-sm text-slate-600">
        فازهای بعدی: هزینه، دفتر روزنامه، تسویه بدهی تأمین‌کننده (۴.۹).
      </p>
    </div>
  );
}
