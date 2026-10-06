import type { DomainEventType } from './domain-events.registry';

export type DomainEventActor = {
  userId?: string;
  companyMemberId?: string;
};

/**
 * Serializable domain-event envelope.
 * Must remain free of Prisma clients, Express Request, and class instances
 * so a future Outbox can persist the same shape.
 */
export type DomainEvent<
  TType extends string = DomainEventType,
  TPayload = Record<string, unknown>,
> = {
  eventId: string;
  type: TType;
  version: number;
  occurredAt: Date;
  companyId?: string;
  actor?: DomainEventActor;
  requestId?: string;
  correlationId: string;
  causationId?: string;
  /** Present when the mutation was driven by CatalogBulkService (Phase 1.10+). */
  bulkOperationId?: string;
  payload: TPayload;
};

export type AnyDomainEvent = DomainEvent<string, Record<string, unknown>>;
