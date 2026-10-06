import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DomainEventBus } from '../domain-event.bus';
import { DOMAIN_EVENTS } from '../domain-events.registry';
import type { AnyDomainEvent } from '../domain-event';

/**
 * Harmless development handler that proves subscription wiring.
 * Logs envelope metadata only — never full payloads.
 */
@Injectable()
export class DomainEventLoggingHandler implements OnModuleInit {
  private readonly logger = new Logger(DomainEventLoggingHandler.name);

  constructor(private readonly eventBus: DomainEventBus) {}

  onModuleInit(): void {
    for (const type of Object.values(DOMAIN_EVENTS)) {
      this.eventBus.subscribe(type, DomainEventLoggingHandler.name, (event) =>
        this.handle(event),
      );
    }
  }

  private handle(event: AnyDomainEvent): void {
    this.logger.debug(
      {
        eventId: event.eventId,
        eventType: event.type,
        companyId: event.companyId,
        correlationId: event.correlationId,
        requestId: event.requestId,
      },
      'domain_event_processed',
    );
  }
}
