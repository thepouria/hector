import { DomainEventBus } from './domain-event.bus';
import { DomainEventFactory } from './domain-event.factory';
import { DOMAIN_EVENTS } from './domain-events.registry';
import { commitThenPublish } from './commit-then-publish';
import type { DomainEvent } from './domain-event';

describe('DomainEventBus', () => {
  const factory = new DomainEventFactory();
  let bus: DomainEventBus;

  beforeEach(() => {
    bus = new DomainEventBus();
  });

  function makeEvent(type: string, marker: string): DomainEvent {
    return factory.create({
      type,
      payload: { marker },
      context: { correlationId: 'test-corr', companyId: 'c1' },
    });
  }

  it('delivers events to registered handlers and allows zero handlers', async () => {
    const received: string[] = [];
    bus.subscribe(DOMAIN_EVENTS.ROLE_CREATED, 'A', async (event) => {
      received.push(String((event.payload as { marker: string }).marker));
    });

    await bus.publish(makeEvent(DOMAIN_EVENTS.ROLE_CREATED, 'one'));
    await expect(bus.publish(makeEvent(DOMAIN_EVENTS.ROLE_DELETED, 'none'))).resolves.toBeUndefined();
    expect(received).toEqual(['one']);
  });

  it('preserves publishMany order and isolates handler failures', async () => {
    const order: string[] = [];

    bus.subscribe(DOMAIN_EVENTS.MEMBER_CREATED, 'ok-a', async () => {
      order.push('A');
    });
    bus.subscribe(DOMAIN_EVENTS.MEMBER_CREATED, 'fail-b', async () => {
      order.push('B');
      throw new Error('boom');
    });
    bus.subscribe(DOMAIN_EVENTS.MEMBER_CREATED, 'ok-c', async () => {
      order.push('C');
    });

    const events = [
      makeEvent(DOMAIN_EVENTS.MEMBER_CREATED, 'e1'),
      makeEvent(DOMAIN_EVENTS.MEMBER_STATUS_CHANGED, 'e2'),
    ];

    bus.subscribe(DOMAIN_EVENTS.MEMBER_STATUS_CHANGED, 'status', async (event) => {
      order.push(String((event.payload as { marker: string }).marker));
    });

    await bus.publishMany(events);

    expect(order).toEqual(['A', 'B', 'C', 'e2']);
  });

  it('ignores duplicate handler registration by name', async () => {
    let count = 0;
    bus.subscribe(DOMAIN_EVENTS.COMPANY_UPDATED, 'once', async () => {
      count += 1;
    });
    bus.subscribe(DOMAIN_EVENTS.COMPANY_UPDATED, 'once', async () => {
      count += 10;
    });

    await bus.publish(makeEvent(DOMAIN_EVENTS.COMPANY_UPDATED, 'x'));
    expect(count).toBe(1);
    expect(bus.handlerCount(DOMAIN_EVENTS.COMPANY_UPDATED)).toBe(1);
  });
});

describe('commitThenPublish', () => {
  it('publishes only after successful work', async () => {
    const bus = new DomainEventBus();
    const factory = new DomainEventFactory();
    const received: string[] = [];
    bus.subscribe(DOMAIN_EVENTS.ROLE_CREATED, 't', async (event) => {
      received.push(event.type);
    });

    await commitThenPublish(bus, async (events) => {
      events.push(
        factory.create({
          type: DOMAIN_EVENTS.ROLE_CREATED,
          payload: { roleId: 'r', key: 'K' },
          context: { correlationId: 'c' },
        }),
      );
      return 'ok';
    });

    expect(received).toEqual([DOMAIN_EVENTS.ROLE_CREATED]);
  });

  it('does not publish when work throws', async () => {
    const bus = new DomainEventBus();
    const factory = new DomainEventFactory();
    let called = false;
    bus.subscribe(DOMAIN_EVENTS.ROLE_CREATED, 't', async () => {
      called = true;
    });

    await expect(
      commitThenPublish(bus, async (events) => {
        events.push(
          factory.create({
            type: DOMAIN_EVENTS.ROLE_CREATED,
            payload: { roleId: 'r', key: 'K' },
            context: { correlationId: 'c' },
          }),
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(called).toBe(false);
  });
});
