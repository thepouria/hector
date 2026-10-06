import { Global, Module } from '@nestjs/common';
import { DomainEventBus } from './domain-event.bus';
import { DomainEventFactory } from './domain-event.factory';
import { DomainEventLoggingHandler } from './handlers/domain-event-logging.handler';

@Global()
@Module({
  providers: [DomainEventBus, DomainEventFactory, DomainEventLoggingHandler],
  exports: [DomainEventBus, DomainEventFactory],
})
export class EventsModule {}
