import type { DomainEvent } from './domain-event';
import type { DomainEventBus } from './domain-event.bus';

/**
 * Runs a unit of work that may collect domain events, then publishes only
 * after the work promise resolves (i.e. after the enclosing transaction commits).
 *
 * Usage:
 * ```ts
 * return commitThenPublish(this.eventBus, async (events) => {
 *   return this.companyContextService.withCompanyLock(id, async (tx) => {
 *     // mutate + audit
 *     events.push(this.eventFactory.create(...));
 *     return result;
 *   });
 * });
 * ```
 *
 * If `work` throws (rollback / validation / audit failure), events are never published.
 */
export async function commitThenPublish<T>(
  eventBus: DomainEventBus,
  work: (events: DomainEvent[]) => Promise<T>,
): Promise<T> {
  const events: DomainEvent[] = [];
  const result = await work(events);
  if (events.length > 0) {
    await eventBus.publishMany(events);
  }
  return result;
}
