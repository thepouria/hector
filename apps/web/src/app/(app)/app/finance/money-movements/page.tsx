import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';

export const metadata: Metadata = {
  title: 'حرکت پول',
};

export default function Page() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="حرکت پول"
        description="پرداخت و دریافت از حساب نقد/بانک؛ انتقال فقط بین حساب‌های هم‌ارز."
      />
      <div className="flex flex-wrap gap-3">
        <Link href={ROUTES.financePayments} className={cn(buttonVariants())}>
          پرداخت‌ها
        </Link>
        <Link
          href={ROUTES.financeReceipts}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          دریافت‌ها
        </Link>
        <Link
          href={ROUTES.financeAccountTransfers}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          انتقال‌ها
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        پست پرداخت به‌تنهایی بدهی تأمین‌کننده را تسویه نمی‌کند — تسویه صریح از بخش بدهی‌ها.
      </p>
    </div>
  );
}
