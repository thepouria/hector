import type { PermissionKey } from './keys';

export function can(permissions: readonly string[], permission: PermissionKey | string): boolean {
  return permissions.includes(permission);
}

export function canAny(
  permissions: readonly string[],
  required: readonly (PermissionKey | string)[],
): boolean {
  return required.some((permission) => permissions.includes(permission));
}

export function canAll(
  permissions: readonly string[],
  required: readonly (PermissionKey | string)[],
): boolean {
  return required.every((permission) => permissions.includes(permission));
}
