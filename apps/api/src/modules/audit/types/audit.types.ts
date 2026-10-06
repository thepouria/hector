export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AuditSnapshot = Record<string, JsonValue> | null;

export type ExplicitAuditContext = {
  companyId: string;
  actorUserId?: string | null;
  actorCompanyMemberId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type RecordAuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: AuditSnapshot;
  after?: AuditSnapshot;
  metadata?: Record<string, JsonValue> | null;
  /**
   * Optional override for non-HTTP / system callers.
   * Authenticated company mutations should omit this and use request context.
   */
  context?: ExplicitAuditContext;
};
