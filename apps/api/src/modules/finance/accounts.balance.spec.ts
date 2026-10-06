import { Prisma } from '@hector/database';
import { formatAccountTransferNumber } from './account-transfer-numbering';

describe('accounts.balance helpers', () => {
  it('formats FAT transfer numbers with 6-digit padding', () => {
    expect(formatAccountTransferNumber(1)).toBe('FAT-000001');
    expect(formatAccountTransferNumber(42)).toBe('FAT-000042');
    expect(formatAccountTransferNumber(1000000)).toBe('FAT-1000000');
  });

  it('rejects non-positive sequences', () => {
    expect(() => formatAccountTransferNumber(0)).toThrow(RangeError);
    expect(() => formatAccountTransferNumber(-1)).toThrow(RangeError);
    expect(() => formatAccountTransferNumber(1.5)).toThrow(RangeError);
  });

  it('Decimal SUM IN-OUT balance math stays exact', () => {
    const inn = new Prisma.Decimal('2000000000');
    const out = new Prisma.Decimal('100000000');
    const balance = inn.sub(out);
    expect(balance.toFixed()).toBe('1900000000');
    expect(balance.add(out).eq(inn)).toBe(true);
  });
});
