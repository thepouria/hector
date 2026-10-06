import { describe, expect, it } from 'vitest';
import {
  groupPermissions,
  presentPermission,
  samePermissionSet,
} from './presentation';

describe('permission presentation', () => {
  it('maps known permissions to Persian labels and groups', () => {
    const presented = presentPermission('member.read');
    expect(presented.group).toBe('members');
    expect(presented.label).toBe('مشاهده اعضا');
  });

  it('falls back safely for unknown permissions', () => {
    const presented = presentPermission('future.domain.read');
    expect(presented.label).toBe('future.domain.read');
    expect(presented.group).toBe('other');
  });

  it('groups permissions by domain', () => {
    const groups = groupPermissions([
      { id: '1', key: 'company.read' },
      { id: '2', key: 'member.read' },
      { id: '3', key: 'weird.permission' },
    ]);
    expect(groups.map((group) => group.group)).toEqual(['company', 'members', 'other']);
  });

  it('treats permission sets as equal regardless of order', () => {
    expect(samePermissionSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(samePermissionSet(['a', 'b'], ['a'])).toBe(false);
  });
});
