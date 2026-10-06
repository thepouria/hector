import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { ROUTES } from '@/lib/utils/routes';

export const metadata: Metadata = {
  title: 'حسابداری',
};

export default function Page() {
  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        title="حسابداری"
        description="دفتر روزنامه و گزارش‌های دفتر — جدا از موجودی نقد حساب‌ها."
      />
      <div className="flex flex-wrap gap-3">
        <Link href={ROUTES.financeJournals} className={cn(buttonVariants())}>
          اسناد روزنامه
        </Link>
        <Link
          href={ROUTES.financeGeneralLedger}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          دفتر کل
        </Link>
        <Link
          href={ROUTES.financeTrialBalance}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          تراز آزمایشی
        </Link>
        <Link
          href={ROUTES.financeLedgerAccounts}
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          حساب‌های دفتر
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        تراز آزمایشی و دفتر کل در ارز پایه شرکت محاسبه می‌شوند. سود/زیان در این فاز نیست.
      </p>
    </div>
  );
}
