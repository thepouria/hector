import { formatOfferAmountParts } from '@/features/purchasing/offer-money';
import type { OfferCurrency } from '@/types/purchasing';

export function OfferPriceDisplay({
  unitPrice,
  currency,
  className,
}: {
  unitPrice: string;
  currency: OfferCurrency;
  className?: string;
}) {
  const { amount, unitLabel } = formatOfferAmountParts(unitPrice, currency);
  return (
    <span className={className}>
      <span dir="ltr" className="font-mono tabular-nums">
        {amount}
      </span>{' '}
      <span className="text-slate-600">{unitLabel}</span>
    </span>
  );
}
