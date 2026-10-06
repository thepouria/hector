export type ExplicitDomainEventContext = {
  companyId?: string | null;
  actorUserId?: string | null;
  actorCompanyMemberId?: string | null;
  requestId?: string | null;
  correlationId?: string;
  causationId?: string;
};
