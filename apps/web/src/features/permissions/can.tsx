'use client';

import { useSession } from '@/providers/app-providers';
import type { PermissionKey } from '@/lib/permissions/keys';

export function Can({
  permission,
  anyOf,
  allOf,
  children,
  fallback = null,
}: {
  permission?: PermissionKey | string;
  anyOf?: readonly (PermissionKey | string)[];
  allOf?: readonly (PermissionKey | string)[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const session = useSession();
  let allowed = true;
  if (permission) allowed = session.can(permission);
  if (anyOf) allowed = session.canAny(anyOf);
  if (allOf) allowed = session.canAll(allOf);
  return allowed ? <>{children}</> : <>{fallback}</>;
}
