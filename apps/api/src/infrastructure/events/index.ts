export { EventsModule } from './events.module';
export { DomainEventBus } from './domain-event.bus';
export { DomainEventFactory } from './domain-event.factory';
export { commitThenPublish } from './commit-then-publish';
export { DOMAIN_EVENTS, DOMAIN_EVENT_VERSION, type DomainEventType } from './domain-events.registry';
export type { DomainEvent, DomainEventActor, AnyDomainEvent } from './domain-event';
export type { ExplicitDomainEventContext } from './event-context';
export type * from './domain-event.types';
