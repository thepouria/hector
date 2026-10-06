import { describe, expect, it } from 'vitest';
import {
  companyKeys,
  memberKeys,
  roleKeys,
  sessionKeys,
} from './keys';

describe('query key factories', () => {
  it('scopes company settings by company id', () => {
    expect(companyKeys.detail('a')).toEqual(['company', 'a']);
    expect(companyKeys.detail('a')).not.toEqual(companyKeys.detail('b'));
  });

  it('scopes members and roles by company id', () => {
    expect(memberKeys.list('a', { page: 1 })[1]).toBe('a');
    expect(roleKeys.detail('a', 'role-1')[1]).toBe('a');
    expect(memberKeys.list('a', { page: 1 })).not.toEqual(
      memberKeys.list('b', { page: 1 }),
    );
  });

  it('keeps sessions user-scoped without company id', () => {
    expect(sessionKeys.list()).toEqual(['sessions']);
  });
});
