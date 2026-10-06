import type { Metadata } from 'next';
import { PlaceholderModule } from '@/components/feedback/states';

export const metadata: Metadata = {
  title: 'کالاها',
};

export default function Page() {
  return (
    <PlaceholderModule
      title="کالاها"
      description="مدیریت کالاها، SKU و بارکد"
      upcoming={[
          'Product',
          'SKU',
          'Barcode',
          'Brand',
          'Category',
      ]}
    />
  );
}
