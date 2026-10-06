import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = {
  title: 'داشبورد',
};

export default function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="داشبورد مدیریتی"
        description="مرکز عملیاتی هکتور برای پایش فروش، موجودی، نقدینگی و تسویه‌ها"
        breadcrumbs={[{ label: 'هکتور' }, { label: 'داشبورد' }]}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          'نقدینگی و سرمایه در دسترس',
          'فروش ۷ و ۳۰ روز اخیر',
          'سود ناخالص و خالص',
          'ریسک موجودی و پیشنهاد خرید',
          'پرداخت‌های تأمین‌کننده',
          'تسویه بازارگاه‌ها',
        ].map((title) => (
          <div
            key={title}
            className="rounded-lg border border-dashed border-slate-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
            <p className="mt-2 text-sm text-slate-500">
              این ویجت در فازهای بعدی با داده‌های واقعی فعال می‌شود. هیچ عدد ساختگی نمایش داده
              نمی‌شود.
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
