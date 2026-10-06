import { WarehouseLocationType } from '@hector/database';
import { ERROR_CODES } from '../../common/constants';
import { AppError } from '../../common/exceptions/app.error';
import {
  assertLocationCode,
  assertOptionalLocationName,
  assertTypeHierarchy,
  normalizeLocationCode,
} from './warehouse-location.normalization';

describe('warehouse-location.normalization', () => {
  it('normalizes location codes with trim + uppercase', () => {
    expect(normalizeLocationCode('  s-01 ')).toBe('S-01');
    expect(assertLocationCode('  s01  ')).toBe('S01');
    expect(assertLocationCode('A-01-R02-S04-B07')).toBe('A-01-R02-S04-B07');
  });

  it('rejects invalid location codes', () => {
    expect(() => assertLocationCode('   ')).toThrow(AppError);
    expect(() => assertLocationCode('shelf a')).toThrow(AppError);
    expect(() => assertLocationCode('x'.repeat(65))).toThrow(AppError);
  });

  it('supports optional Persian names', () => {
    expect(assertOptionalLocationName('  قفسه   ریمل ')).toBe('قفسه ریمل');
    expect(assertOptionalLocationName('   ')).toBeNull();
    expect(assertOptionalLocationName(undefined)).toBeNull();
  });

  it('allows skipped type levels and root of any type', () => {
    expect(() => assertTypeHierarchy(WarehouseLocationType.SHELF, null)).not.toThrow();
    expect(() =>
      assertTypeHierarchy(WarehouseLocationType.SHELF, WarehouseLocationType.ZONE),
    ).not.toThrow();
    expect(() =>
      assertTypeHierarchy(WarehouseLocationType.BIN, WarehouseLocationType.RACK),
    ).not.toThrow();
    expect(() =>
      assertTypeHierarchy(WarehouseLocationType.SHELF, WarehouseLocationType.SHELF),
    ).not.toThrow();
  });

  it('rejects inverted type hierarchy', () => {
    try {
      assertTypeHierarchy(WarehouseLocationType.ZONE, WarehouseLocationType.BIN);
      throw new Error('expected type inversion rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ERROR_CODES.WAREHOUSE_LOCATION_TYPE_INVERSION);
    }
  });
});
