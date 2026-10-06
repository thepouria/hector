import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';

export const metadata: Metadata = {
  title: 'تسویه‌ها',
};

export default function Page() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="تسویه‌ها"
        description="تخصیص صریح پرداخت پست‌شده به بدهی تأمین‌کننده. پست پرداخت ≠ تسویه."
      />
      <div className="flex flex-wrap gap-3">
        <Link href={ROUTES.financePayments} className={cn(buttonVariants())}>
          پرداخت‌ها (شروع تسویه)
        </Link>
        <Link
          href={ROUTES.financePayables}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          حساب‌های پرداختنی
        </Link>
        <Link
          href={ROUTES.financeLiabilities}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          بازگشت به بدهی‌ها
        </Link>
      </div>
      <ul className="list-disc space-y-2 pr-5 text-sm text-muted-foreground">
        <li>از جزئیات پرداخت پست‌شده، بدهی را انتخاب و تسویه کنید.</li>
        <li>از جزئیات بدهی نیز می‌توانید با شناسه پرداخت، پیش‌نمایش و تسویه بگیرید.</li>
        <li>برگشت تسویه از همان صفحه یا API مربوطه — برگشت پرداخت تسویه‌ها را هم برمی‌گرداند.</li>
      </ul>
    </div>
  );
}
