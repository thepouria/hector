import { Injectable, Logger } from '@nestjs/common';
import type { AnyDomainEvent, DomainEvent } from './domain-event';

export type DomainEventHandlerFn = (event: AnyDomainEvent) => Promise<void> | void;

type RegisteredHandler = {
  name: string;
  handle: DomainEventHandlerFn;
};

/**
 * In-process, post-commit domain event bus.
 *
 * Delivery is NOT durable across process crashes. Handlers must remain
 * non-critical until a transactional Outbox exists.
 *
 * Semantics:
 * - publishMany preserves producer event order
 * - handlers for one event run sequentially
 * - handler failures are isolated (logged; other handlers still run)
 * - unknown event types (zero handlers) are allowed
 */
@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly handlersByType = new Map<string, RegisteredHandler[]>();

  /**
   * Register a handler for an event type.
   * Duplicate (type + name) registrations are ignored.
   */
  subscribe(type: string, name: string, handle: DomainEventHandlerFn): void {
    const existing = this.handlersByType.get(type) ?? [];
    if (existing.some((handler) => handler.name === name)) {
      return;
    }
    this.handlersByType.set(type, [...existing, { name, handle }]);
  }

  /** Test / infrastructure helper — clear all registrations. */
  clear(): void {
    this.handlersByType.clear();
  }

  /** Test helper — registered handler count for a type. */
  handlerCount(type: string): number {
    return this.handlersByType.get(type)?.length ?? 0;
  }

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlersByType.get(event.type) ?? [];
    if (handlers.length === 0) {
      return;
    }

    this.logger.debug(
      {
        eventId: event.eventId,
        eventType: event.type,
        companyId: event.companyId,
        correlationId: event.correlationId,
        handlerCount: handlers.length,
      },
      'domain_event_dispatched',
    );

    for (const handler of handlers) {
      try {
        await handler.handle(event as AnyDomainEvent);
      } catch (error) {
        this.logger.error(
          {
            eventId: event.eventId,
            eventType: event.type,
            companyId: event.companyId,
            correlationId: event.correlationId,
            handler: handler.name,
            err: error instanceof Error ? { message: error.message, name: error.name } : error,
          },
          'domain_event_handler_failed',
        );
      }
    }
  }

  async publishMany(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      try {
        await this.publish(event);
      } catch (error) {
        // publish() already isolates handler failures; this catches unexpected bus errors.
        this.logger.error(
          {
            eventId: event.eventId,
            eventType: event.type,
            companyId: event.companyId,
            correlationId: event.correlationId,
            err: error instanceof Error ? { message: error.message, name: error.name } : error,
          },
          'domain_event_dispatch_failed',
        );
      }
    }
  }
}
