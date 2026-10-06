/**
 * GTIN / EAN / UPC checksum utilities (pure).
 * Algorithm: from the right (excluding check digit), odd positions ×3, even ×1;
 * check digit = (10 - (sum % 10)) % 10.
 */

export function gtinCheckDigit(bodyWithoutCheck: string): number {
  let sum = 0;
  for (let i = 0; i < bodyWithoutCheck.length; i++) {
    const digit = Number(bodyWithoutCheck[bodyWithoutCheck.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidGtinChecksum(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  return gtinCheckDigit(body) === check;
}

export function validateEan13(value: string): boolean {
  return /^\d{13}$/.test(value) && hasValidGtinChecksum(value);
}

export function validateEan8(value: string): boolean {
  return /^\d{8}$/.test(value) && hasValidGtinChecksum(value);
}

export function validateUpcA(value: string): boolean {
  return /^\d{12}$/.test(value) && hasValidGtinChecksum(value);
}

/** Append correct check digit to a body (EAN-13 body = 12 digits, etc.). */
export function withGtinCheckDigit(bodyWithoutCheck: string): string {
  return `${bodyWithoutCheck}${gtinCheckDigit(bodyWithoutCheck)}`;
}
