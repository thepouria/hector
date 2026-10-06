import type { AuditSnapshot } from '../types/audit.types';

export function buildCompanySnapshot(company: {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  baseCurrency: string;
  status: string;
}): AuditSnapshot {
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    timezone: company.timezone,
    baseCurrency: company.baseCurrency,
    status: company.status,
  };
}

export function buildCompanyEditableSnapshot(company: {
  name: string;
  timezone: string;
}): AuditSnapshot {
  return {
    name: company.name,
    timezone: company.timezone,
  };
}

export function buildMemberSnapshot(member: {
  id: string;
  userId: string;
  status: string;
  roles?: Array<{ id: string; key: string }>;
}): AuditSnapshot {
  return {
    id: member.id,
    userId: member.userId,
    status: member.status,
    ...(member.roles
      ? {
          roles: [...member.roles]
            .map((role) => ({ id: role.id, key: role.key }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        }
      : {}),
  };
}

export function buildMemberStatusSnapshot(status: string): AuditSnapshot {
  return { status };
}

export function buildMemberRolesSnapshot(
  roles: Array<{ id: string; key: string }>,
): AuditSnapshot {
  return {
    roles: [...roles]
      .map((role) => ({ id: role.id, key: role.key }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export function buildRoleSnapshot(role: {
  id: string;
  name: string;
  key: string;
  description: string | null;
  isSystem: boolean;
  permissions?: string[];
  deletedAt?: Date | null;
}): AuditSnapshot {
  return {
    id: role.id,
    name: role.name,
    key: role.key,
    description: role.description,
    isSystem: role.isSystem,
    ...(role.permissions
      ? { permissions: [...role.permissions].sort((a, b) => a.localeCompare(b)) }
      : {}),
    ...(role.deletedAt !== undefined
      ? { deletedAt: role.deletedAt ? role.deletedAt.toISOString() : null }
      : {}),
  };
}

export function buildRoleMetadataSnapshot(role: {
  name: string;
  description: string | null;
}): AuditSnapshot {
  return {
    name: role.name,
    description: role.description,
  };
}

export function buildRolePermissionsSnapshot(permissions: string[]): AuditSnapshot {
  return {
    permissions: [...permissions].sort((a, b) => a.localeCompare(b)),
  };
}
