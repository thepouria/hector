import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@hector/database';
import { REQUIRE_PERMISSIONS_KEY } from '../../../common/constants';

/**
 * Requires ALL listed permissions (AND semantics).
 * Must run after authentication and company context resolution.
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);
