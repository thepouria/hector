import type { PurchaseCommercialType } from '@/types/purchasing';

/** Which commercial sections the PO create/edit form should show. */
export function purchaseTypeFormVisibility(purchaseType: PurchaseCommercialType): {
  showCreditTerms: boolean;
  showFx: boolean;
  showCashOnly: boolean;
} {
  return {
    showCreditTerms: purchaseType === 'TERM_CREDIT' || purchaseType === 'FX_CREDIT',
    showFx: purchaseType === 'FX_CREDIT',
    showCashOnly: purchaseType === 'CASH',
  };
}

export function isCommittedPurchaseStatus(
  status: 'DRAFT' | 'APPROVED' | 'ORDERED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED',
): boolean {
  return status === 'APPROVED' || status === 'ORDERED';
}
