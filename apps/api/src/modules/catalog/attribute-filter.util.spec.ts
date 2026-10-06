import { describe, expect, it } from '@jest/globals';
import { AttributeType } from '@hector/database';
import { AppError } from '../../common/exceptions/app.error';
import {
  assertOperatorForType,
  parseAttributeFiltersParam,
} from './attribute-filter.util';

describe('attribute-filter.util', () => {
  it('parses comma-separated attrs segments', () => {
    expect(parseAttributeFiltersParam('spf:gte:30,oil_free:eq:true')).toEqual([
      { code: 'spf', op: 'gte', rawValue: '30' },
      { code: 'oil_free', op: 'eq', rawValue: 'true' },
    ]);
  });

  it('normalizes attribute codes', () => {
    expect(parseAttributeFiltersParam('Oil Free:eq:true')).toEqual([
      { code: 'oil_free', op: 'eq', rawValue: 'true' },
    ]);
  });

  it('allows colons inside the value portion', () => {
    expect(parseAttributeFiltersParam('note:eq:a:b:c')).toEqual([
      { code: 'note', op: 'eq', rawValue: 'a:b:c' },
    ]);
  });

  it('returns empty for blank input', () => {
    expect(parseAttributeFiltersParam(undefined)).toEqual([]);
    expect(parseAttributeFiltersParam('   ')).toEqual([]);
  });

  it('rejects malformed segments and unknown operators', () => {
    expect(() => parseAttributeFiltersParam('spf')).toThrow(AppError);
    expect(() => parseAttributeFiltersParam('spf:bogus:1')).toThrow(AppError);
  });

  it('rejects operators that do not match attribute type', () => {
    expect(() => assertOperatorForType(AttributeType.BOOLEAN, 'gte')).toThrow(AppError);
    expect(() => assertOperatorForType(AttributeType.NUMBER, 'contains')).toThrow(AppError);
    expect(() => assertOperatorForType(AttributeType.TEXT, 'containsAny')).toThrow(AppError);
    expect(() => assertOperatorForType(AttributeType.MULTI_SELECT, 'eq')).toThrow(AppError);
  });

  it('allows valid operator/type combinations', () => {
    expect(() => assertOperatorForType(AttributeType.NUMBER, 'gte')).not.toThrow();
    expect(() => assertOperatorForType(AttributeType.BOOLEAN, 'eq')).not.toThrow();
    expect(() => assertOperatorForType(AttributeType.SINGLE_SELECT, 'in')).not.toThrow();
    expect(() => assertOperatorForType(AttributeType.MULTI_SELECT, 'containsAll')).not.toThrow();
    expect(() => assertOperatorForType(AttributeType.TEXT, 'hasValue')).not.toThrow();
  });
});
