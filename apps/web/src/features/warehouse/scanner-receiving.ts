/**
 * Pure helpers for barcode scanner receiving UI (Phase 3.6).
 * Domain mutation stays on the API — this module is presentation/workflow only.
 */

import { normalizeScannerInput } from '@/lib/utils/scanner-input';

export type ScannerMode = 'UNIT' | 'QUANTITY';

export const DEFAULT_SCANNER_MODE: ScannerMode = 'QUANTITY';

export { normalizeScannerInput };

export function availableToAdd(remainingQuantity: number, draftQuantity: number): number {
  return Math.max(0, remainingQuantity - draftQuantity);
}

export type ScanHistoryKind = 'success' | 'unknown' | 'wrong_sku' | 'error' | 'capacity';

export type ScanHistoryEntry = {
  id: string;
  at: string;
  kind: ScanHistoryKind;
  barcode: string;
  label: string;
  quantity?: number;
};

export function formatScanHistoryLabel(input: {
  kind: ScanHistoryKind;
  skuCode?: string | null;
  barcode: string;
  quantity?: number;
  message?: string;
}): string {
  switch (input.kind) {
    case 'success':
      return `✓ ${input.skuCode ?? input.barcode}${input.quantity != null ? ` +${input.quantity}` : ''}`;
    case 'unknown':
      return `✕ ${input.barcode} UNKNOWN`;
    case 'wrong_sku':
      return `⚠ ${input.skuCode ?? input.barcode} NOT IN PO`;
    case 'capacity':
      return `⚠ ${input.message ?? 'CAPACITY'}`;
    default:
      return `✕ ${input.message ?? input.barcode}`;
  }
}

/** Lightweight optional beep via Web Audio (no assets). Failures are ignored. */
export function playScannerTone(kind: 'success' | 'error', enabled: boolean): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = kind === 'success' ? 880 : 220;
    gain.gain.value = 0.04;
    osc.start();
    osc.stop(ctx.currentTime + (kind === 'success' ? 0.08 : 0.16));
    void ctx.close();
  } catch {
    // autoplay / unsupported — visual feedback remains authoritative
  }
}
