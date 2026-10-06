import { AppError } from '../../common/exceptions/app.error';
import {
  assertOptionalAddress,
  assertOptionalNotes,
  assertWarehouseCode,
  assertWarehouseName,
  normalizeWarehouseCode,
} from './warehouse.normalization';

describe('warehouse.normalization', () => {
  it('normalizes warehouse codes with trim + uppercase', () => {
    expect(normalizeWarehouseCode('  thr-01  ')).toBe('THR-01');
    expect(assertWarehouseCode('  main  ')).toBe('MAIN');
    expect(assertWarehouseCode('RETURNS_01')).toBe('RETURNS_01');
  });

  it('rejects invalid warehouse codes', () => {
    expect(() => assertWarehouseCode('   ')).toThrow(AppError);
    expect(() => assertWarehouseCode('main warehouse')).toThrow(AppError);
    expect(() => assertWarehouseCode('x'.repeat(65))).toThrow(AppError);
  });

  it('supports Persian warehouse names', () => {
    expect(assertWarehouseName('  انبار   اصلی ')).toBe('انبار اصلی');
    expect(() => assertWarehouseName('   ')).toThrow(AppError);
  });

  it('normalizes empty optional address/notes to null', () => {
    expect(assertOptionalAddress('   ')).toBeNull();
    expect(assertOptionalNotes(undefined)).toBeNull();
    expect(assertOptionalAddress('تهران، بازار بزرگ')).toBe('تهران، بازار بزرگ');
  });
});
