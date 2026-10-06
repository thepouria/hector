import { requestContext } from '../../common/context/request-context';
import { DomainEventFactory } from './domain-event.factory';
import { DOMAIN_EVENTS, DOMAIN_EVENT_VERSION } from './domain-events.registry';

describe('DomainEventFactory', () => {
  const factory = new DomainEventFactory();

  it('builds a complete envelope from request context', () => {
    const event = requestContext.run(
      {
        requestId: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4222-8222-222222222222',
        companyId: '33333333-3333-4333-8333-333333333333',
        companyMemberId: '44444444-4444-4444-8444-444444444444',
      },
      () =>
        factory.create({
          type: DOMAIN_EVENTS.COMPANY_UPDATED,
          payload: { companyId: '33333333-3333-4333-8333-333333333333', changedFields: ['name'] },
        }),
    );

    expect(event.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(event.type).toBe(DOMAIN_EVENTS.COMPANY_UPDATED);
    expect(event.version).toBe(DOMAIN_EVENT_VERSION);
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.companyId).toBe('33333333-3333-4333-8333-333333333333');
    expect(event.actor).toEqual({
      userId: '22222222-2222-4222-8222-222222222222',
      companyMemberId: '44444444-4444-4444-8444-444444444444',
    });
    expect(event.requestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(event.correlationId).toBe('11111111-1111-4111-8111-111111111111');
    expect(event.causationId).toBeUndefined();
    expect(event.payload).toEqual({
      companyId: '33333333-3333-4333-8333-333333333333',
      changedFields: ['name'],
    });
  });

  it('supports explicit system context and causation chains', () => {
    const parent = factory.create({
      type: DOMAIN_EVENTS.ROLE_CREATED,
      payload: { roleId: 'r1', key: 'SALES' },
      context: {
        companyId: 'c1',
        actorUserId: null,
        actorCompanyMemberId: null,
        requestId: null,
        correlationId: 'corr-1',
      },
    });

    const child = factory.create({
      type: DOMAIN_EVENTS.ROLE_PERMISSIONS_CHANGED,
      payload: {
        roleId: 'r1',
        previousPermissionKeys: [],
        newPermissionKeys: ['member.read'],
      },
      causedBy: parent,
    });

    expect(parent.actor).toBeUndefined();
    expect(parent.correlationId).toBe('corr-1');
    expect(child.correlationId).toBe('corr-1');
    expect(child.causationId).toBe(parent.eventId);
    expect(child.companyId).toBe('c1');
    expect(child.eventId).not.toBe(parent.eventId);
  });

  it('generates unique event ids', () => {
    const a = factory.create({
      type: DOMAIN_EVENTS.MEMBER_REMOVED,
      payload: { memberId: 'm1', userId: 'u1' },
      context: { correlationId: 'x' },
    });
    const b = factory.create({
      type: DOMAIN_EVENTS.MEMBER_REMOVED,
      payload: { memberId: 'm1', userId: 'u1' },
      context: { correlationId: 'x' },
    });
    expect(a.eventId).not.toBe(b.eventId);
  });
});
