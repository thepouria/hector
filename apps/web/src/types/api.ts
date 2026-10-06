export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
};

export type Company = {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  timezone: string;
  status: string;
};

export type RoleSummary = {
  id: string;
  key: string;
  name: string;
};

export type Member = {
  id: string;
  status: string;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
  roles: RoleSummary[];
};

export type RolePermission = {
  id: string;
  key: string;
};

export type Role = {
  id: string;
  name: string;
  key: string;
  description: string | null;
  isSystem: boolean;
  permissions: RolePermission[];
};

export type PermissionCatalogItem = {
  id: string;
  key: string;
  description: string | null;
};

export type AuthorizationSnapshot = {
  companyId: string;
  companyMemberId: string;
  roles: RoleSummary[];
  permissions: string[];
};

export type AuditListItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  requestId: string | null;
  createdAt: string;
  bulkOperationId: string | null;
  before: unknown;
  after: unknown;
  actor: {
    userId: string | null;
    companyMemberId: string | null;
    email: string | null;
    displayName: string | null;
  };
};

export type AuditDetail = AuditListItem & {
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
};

export type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AuthSession = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
  revoked: boolean;
};
