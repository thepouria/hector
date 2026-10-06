import { describe, expect, it } from 'vitest';
import {
  SETTINGS_NAV,
  filterSettingsNav,
  settingsSectionAccessible,
} from '@/features/settings/settings-nav-config';
import { PERMISSIONS } from '@/lib/permissions/keys';

describe('settings navigation', () => {
  it('shows only accessible sections', () => {
    const items = filterSettingsNav(SETTINGS_NAV, (permission) =>
      permission === PERMISSIONS.MEMBER_READ,
    );
    expect(items.map((item) => item.id)).toEqual(['members', 'security']);
  });

  it('always includes security without company permission', () => {
    const items = filterSettingsNav(SETTINGS_NAV, () => false);
    expect(items.map((item) => item.id)).toEqual(['security']);
  });

  it('gates section access', () => {
    expect(settingsSectionAccessible('roles', () => false)).toBe(false);
    expect(settingsSectionAccessible('security', () => false)).toBe(true);
    expect(settingsSectionAccessible('overview', () => false)).toBe(true);
  });
});
