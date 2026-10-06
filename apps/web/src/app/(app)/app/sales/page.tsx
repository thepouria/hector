import type { Metadata } from 'next';
import { PlaceholderModule } from '@/components/feedback/states';

export const metadata: Metadata = {
  title: 'فروش',
};

export default function Page() {
  return (
    <PlaceholderModule
      title="فروش"
      description="کانال‌های فروش و سفارش‌ها"
      upcoming={[
          'خانومی',
          'دیجی‌کالا',
          'اسنپ‌شاپ',
          'سایت پیشته',
      ]}
    />
  );
}
