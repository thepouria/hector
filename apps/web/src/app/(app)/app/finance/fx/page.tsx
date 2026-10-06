import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';

export const metadata: Metadata = {
  title: 'ارز / FX',
};

export default function Page() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="ارز / FX"
        description="نرخ‌ها، تبدیل ارز بین حساب‌ها، و موقعیت ارزی. ارز اصلی هر تعهد حفظ می‌شود — ارزش‌گذاری فقط خواندنی است."
      />
      <div className="flex flex-wrap gap-3">
        <Link href={ROUTES.financeFxRates} className={cn(buttonVariants())}>
          نرخ‌ها
        </Link>
        <Link
          href={ROUTES.financeFxConversions}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          تبدیل‌ها
        </Link>
        <Link
          href={ROUTES.financeFxPositions}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          موقعیت ارزی
        </Link>
      </div>
      <p className="text-sm text-slate-600">
        نرخ‌ها به‌صورت صریح نمایش داده می‌شوند (مثلاً ۱ USD = ۲۵۰٬۰۰۰ IRR). تبدیل هم‌ارز رد می‌شود —
        از انتقال حساب استفاده کنید.
      </p>
    </div>
  );
}
