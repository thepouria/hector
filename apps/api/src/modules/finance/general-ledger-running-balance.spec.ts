import { JournalLineDirection } from '@hector/database';
import {
  computeRunningBalances,
  signedBaseDelta,
} from './general-ledger-running-balance';

describe('general-ledger-running-balance', () => {
  it('signs debit positive and credit negative', () => {
    expect(signedBaseDelta({ direction: JournalLineDirection.DEBIT, baseAmount: '100' }).toFixed()).toBe(
      '100',
    );
    expect(
      signedBaseDelta({ direction: JournalLineDirection.CREDIT, baseAmount: '40' }).toFixed(),
    ).toBe('-40');
  });

  it('computes running balances from opening', () => {
    const { runningBalances, closingBalanceBase } = computeRunningBalances('1000', [
      { direction: JournalLineDirection.DEBIT, baseAmount: '200' },
      { direction: JournalLineDirection.CREDIT, baseAmount: '50' },
      { direction: JournalLineDirection.DEBIT, baseAmount: '10' },
    ]);
    expect(runningBalances).toEqual(['1200', '1150', '1160']);
    expect(closingBalanceBase).toBe('1160');
  });

  it('starts at zero opening', () => {
    const { runningBalances, closingBalanceBase } = computeRunningBalances(0, [
      { direction: JournalLineDirection.CREDIT, baseAmount: '25' },
    ]);
    expect(runningBalances).toEqual(['-25']);
    expect(closingBalanceBase).toBe('-25');
  });
});
