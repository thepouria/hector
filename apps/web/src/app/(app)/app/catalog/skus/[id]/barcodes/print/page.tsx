import { Suspense } from 'react';
import { SkuBarcodePrintPage } from '@/features/catalog/sku-barcode-print-page';
import { PageSkeleton } from '@/components/feedback/states';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SkuBarcodePrintPage />
    </Suspense>
  );
}
