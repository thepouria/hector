/** Strip control characters; preserve barcode string identity (leading zeros). */
export function normalizeScannerInput(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}
