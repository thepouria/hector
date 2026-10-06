import type { Metadata } from 'next';
import { PlaceholderModule } from '@/components/feedback/states';

export const metadata: Metadata = {
  title: 'تسویه‌ها',
};

export default function Page() {
  return (
    <PlaceholderModule
      title="تسویه‌ها"
      description="مغایرت‌گیری و تسویه بازارگاه"
      upcoming={[
          'صورتحساب خانومی/دیجی‌کالا',
          'کمیسیون',
          'مرجوعی',
          'جریمه',
          'مغایرت',
      ]}
    />
  );
}
