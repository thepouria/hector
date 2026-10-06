import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { getRequestContext } from '../../common/context/request-context';
import { getCatalogMutationContext } from '../../modules/catalog/catalog-mutation.context';
import type { DomainEvent } from './domain-event';
import { DOMAIN_EVENT_VERSION } from './domain-events.registry';
import type { ExplicitDomainEventContext } from './event-context';

export type CreateDomainEventInput<TType extends string, TPayload> = {
  type: TType;
  payload: TPayload;
  /**
   * Trusted override for system/background callers (no HTTP request context).
   * Controllers must never expose this path.
   */
  context?: ExplicitDomainEventContext;
  /**
   * When creating a follow-up event from a handler, pass the parent event
   * so correlationId is preserved and causationId is set.
   */
  causedBy?: Pick<
    DomainEvent,
    'eventId' | 'correlationId' | 'requestId' | 'companyId' | 'actor' | 'bulkOperationId'
  >;
};

@Injectable()
export class DomainEventFactory {
  create<TType extends string, TPayload extends Record<string, unknown>>(
    input: CreateDomainEventInput<TType, TPayload>,
  ): DomainEvent<TType, TPayload> {
    const store = getRequestContext();
    const mutation = getCatalogMutationContext();
    const explicit = input.context;
    const parent = input.causedBy;

    const requestId =
      explicit?.requestId !== undefined
        ? (explicit.requestId ?? undefined)
        : (parent?.requestId ?? store?.requestId);

    const correlationId =
      explicit?.correlationId ??
      parent?.correlationId ??
      requestId ??
      randomUUID();

    const companyId =
      explicit?.companyId !== undefined
        ? (explicit.companyId ?? undefined)
        : (parent?.companyId ?? store?.companyId);

    const actorUserId =
      explicit && 'actorUserId' in explicit
        ? (explicit.actorUserId ?? undefined)
        : (parent?.actor?.userId ?? store?.userId);

    const actorCompanyMemberId =
      explicit && 'actorCompanyMemberId' in explicit
        ? (explicit.actorCompanyMemberId ?? undefined)
        : (parent?.actor?.companyMemberId ?? store?.companyMemberId);

    const actor =
      actorUserId || actorCompanyMemberId
        ? {
            ...(actorUserId ? { userId: actorUserId } : {}),
            ...(actorCompanyMemberId ? { companyMemberId: actorCompanyMemberId } : {}),
          }
        : undefined;

    const bulkOperationId = parent?.bulkOperationId ?? mutation?.bulkOperationId;

    return {
      eventId: randomUUID(),
      type: input.type,
      version: DOMAIN_EVENT_VERSION,
      occurredAt: new Date(),
      ...(companyId ? { companyId } : {}),
      ...(actor ? { actor } : {}),
      ...(requestId ? { requestId } : {}),
      correlationId,
      ...(explicit?.causationId
        ? { causationId: explicit.causationId }
        : parent?.eventId
          ? { causationId: parent.eventId }
          : {}),
      ...(bulkOperationId ? { bulkOperationId } : {}),
      payload: input.payload,
    };
  }
}
