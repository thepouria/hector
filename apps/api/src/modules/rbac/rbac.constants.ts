export const RBAC_ERROR_MESSAGES = {
  FORBIDDEN: 'You do not have permission to perform this action.',
  ROLE_NOT_FOUND: 'Role not found.',
  ROLE_ALREADY_EXISTS: 'A role with this key already exists in the company.',
  ROLE_IN_USE: 'Role is assigned to one or more members and cannot be deleted.',
  ROLE_SYSTEM_PROTECTED: 'System roles cannot be modified or deleted this way.',
  PERMISSION_NOT_FOUND: 'One or more permissions were not found.',
  INVALID_ROLE_ASSIGNMENT: 'One or more roles cannot be assigned.',
  ROLE_PERMISSION_ESCALATION:
    'Cannot assign roles or permissions that exceed your own authorization.',
  OWNER_REQUIRED: 'Only an active company owner may perform this ownership action.',
  LAST_OWNER_REQUIRED: 'Cannot leave the company without at least one active owner.',
  INVALID_ROLE_KEY: 'Role key must be uppercase snake case (e.g. SALES_MANAGER).',
} as const;

export const ROLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
