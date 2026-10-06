import { can, canAll, canAny } from './can';

describe('permission helpers', () => {
  const permissions = ['audit.read', 'member.read', 'role.read'];

  it('checks single permission', () => {
    expect(can(permissions, 'audit.read')).toBe(true);
    expect(can(permissions, 'company.update')).toBe(false);
  });

  it('checks any/all', () => {
    expect(canAny(permissions, ['company.update', 'audit.read'])).toBe(true);
    expect(canAll(permissions, ['audit.read', 'member.read'])).toBe(true);
    expect(canAll(permissions, ['audit.read', 'company.update'])).toBe(false);
  });
});
