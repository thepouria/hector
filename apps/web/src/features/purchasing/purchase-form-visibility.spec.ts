import { describe, expect, it } from 'vitest';
import {
  isCommittedPurchaseStatus,
  purchaseTypeFormVisibility,
} from '@/features/purchasing/purchase-form-visibility';

describe('purchase form visibility', () => {
  it('hides FX and credit fields for CASH', () => {
    expect(purchaseTypeFormVisibility('CASH')).toEqual({
      showCreditTerms: false,
      showFx: false,
      showCashOnly: true,
    });
  });

  it('shows credit terms without FX for TERM_CREDIT', () => {
    expect(purchaseTypeFormVisibility('TERM_CREDIT')).toEqual({
      showCreditTerms: true,
      showFx: false,
      showCashOnly: false,
    });
  });

  it('shows credit terms and FX for FX_CREDIT', () => {
    expect(purchaseTypeFormVisibility('FX_CREDIT')).toEqual({
      showCreditTerms: true,
      showFx: true,
      showCashOnly: false,
    });
  });

  it('treats approved/ordered as committed for correction UX', () => {
    expect(isCommittedPurchaseStatus('DRAFT')).toBe(false);
    expect(isCommittedPurchaseStatus('APPROVED')).toBe(true);
    expect(isCommittedPurchaseStatus('ORDERED')).toBe(true);
    expect(isCommittedPurchaseStatus('CANCELLED')).toBe(false);
  });
});
