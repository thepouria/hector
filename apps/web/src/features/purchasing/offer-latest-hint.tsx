'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { fetchLatestSupplierOffer } from '@/lib/api/hector';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { offerKeys } from '@/lib/query/keys';
import { purchasingOfferPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import { OfferPriceDisplay } from '@/features/purchasing/offer-price-display';
import { formatQuoteAge } from '@/features/purchasing/offer-labels';

export function OfferLatestHint({
  supplierId,
  skuId,
}: {
  supplierId: string;
  skuId: string;
}) {
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';

  const latestQuery = useQuery({
    queryKey: offerKeys.latest(companyId, supplierId, skuId),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchLatestSupplierOffer(companyId, supplierId, skuId),
  });

  const latest = latestQuery.data;
  if (latestQuery.isPending || !latest) return null;

  const age = formatQuoteAge(latest.quotedAt);

  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      role="status"
    >
      <span className="font-medium">آخرین قیمت:</span>{' '}
      <OfferPriceDisplay unitPrice={latest.unitPrice} currency={latest.currency} /> —{' '}
      <span>{age.relative}</span>
      <span className="mx-1 text-amber-800/70">·</span>
      <span className="text-xs text-amber-900/80">{age.exact}</span>
      <Link
        href={purchasingOfferPath(latest.id)}
        className="ms-2 text-xs font-medium text-amber-950 underline"
      >
        مشاهده
      </Link>
    </div>
  );
}
