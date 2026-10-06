export type AuthPrincipal = {
  userId: string;
  sessionId: string;
};

export type AccessTokenClaims = {
  sub: string;
  sid: string;
};

export type AuthenticatedUserView = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
};

export type AuthSessionView = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
  current: boolean;
  revoked: boolean;
};
