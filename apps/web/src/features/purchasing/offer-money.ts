import type { OfferCurrency } from '@/types/purchasing';

/** Integer Toman (digits only) → rials string for API (×10). */
export function tomanInputToRialsString(toman: string): string | null {
  const trimmed = toman.trim().replace(/,/g, '');
  if (!/^\d+$/.test(trimmed) || trimmed === '0') return null;
  return `${trimmed}0`;
}

/** API rials decimal string → Toman display string (÷10), no JS Number authority. */
export function rialsStringToTomanDisplay(rials: string): string {
  const s = rials.trim();
  if (!s) return '';
  const dot = s.indexOf('.');
  const intPart = dot === -1 ? s : s.slice(0, dot);
  const decPart = dot === -1 ? '' : s.slice(dot + 1);
  if (!/^\d+$/.test(intPart) || (decPart && !/^\d*$/.test(decPart))) return s;
  if (intPart === '0' && !decPart) return '0';
  const lastRial = intPart.slice(-1);
  const head = intPart.length <= 1 ? '' : intPart.slice(0, -1);
  const tomanDec = `${lastRial}${decPart}`.replace(/0+$/, '');
  if (tomanDec) return `${head || '0'}.${tomanDec}`;
  return head || '0';
}

export function formatOfferAmountParts(
  unitPrice: string,
  currency: OfferCurrency,
): { amount: string; unitLabel: string } {
  if (currency === 'USD') {
    return { amount: unitPrice, unitLabel: 'دلار' };
  }
  const toman = rialsStringToTomanDisplay(unitPrice);
  return { amount: formatGroupedDigits(toman), unitLabel: 'تومان' };
}

export function formatGroupedDigits(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const [whole, frac] = trimmed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Compare two positive decimal strings (for same-currency min highlight). */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const na = normalizeDecimal(a);
  const nb = normalizeDecimal(b);
  if (na === nb) return 0;
  if (na.length !== nb.length) return na.length < nb.length ? -1 : 1;
  return na < nb ? -1 : 1;
}

function normalizeDecimal(value: string): string {
  const s = value.trim();
  const dot = s.indexOf('.');
  const intPart = (dot === -1 ? s : s.slice(0, dot)).replace(/^0+(?=\d)/, '') || '0';
  const frac = dot === -1 ? '' : s.slice(dot + 1).replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart;
}
