import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { financeExpensesUnpaidPath, ROUTES } from '@/lib/utils/routes';

export const metadata: Metadata = {
  title: 'بدهی‌ها',
};

export default function Page() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="بدهی‌ها"
        description="تعهدات پرداختنی — جدا از حرکت نقد. وام اینجا است؛ سرمایه در بخش سرمایه."
      />
      <div className="flex flex-wrap gap-3">
        <Link href={ROUTES.financePayables} className={cn(buttonVariants())}>
          حساب‌های پرداختنی تأمین‌کننده
        </Link>
        <Link href={ROUTES.financeLoans} className={cn(buttonVariants({ variant: 'outline' }))}>
          وام‌ها
        </Link>
        <Link
          href={financeExpensesUnpaidPath()}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          هزینه‌های پرداخت‌نشده
        </Link>
        <Link
          href={ROUTES.financeSettlements}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          تسویه‌ها
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        تسویه بدهی تأمین‌کننده از پرداخت پست‌شده انجام می‌شود — نه با پست خودکار پرداخت.
      </p>
    </div>
  );
}
