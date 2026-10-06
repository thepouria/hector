import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  PERMISSIONS,
  UserStatus,
  syncOwnerRolePermissions,
} from '@hector/database';
import {
  DOMAIN_EVENTS,
  DomainEventBus,
  type DomainEvent,
} from '../src/infrastructure/events';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../src/modules/audit/audit.constants';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

describe('Domain Events (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let eventBus: DomainEventBus;
  let auditService: AuditService;

  const sink: {
    received: DomainEvent[];
    handlerCalls: string[];
  } = {
    received: [],
    handlerCalls: [],
  };

  const password = E2E_PASSWORD;
  const ownerEmail = 'pouria@hector.local';
  let pishtehId: string;
  let ownerUserId: string;
  let ownerMemberId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    eventBus = app.get(DomainEventBus);
    auditService = app.get(AuditService);
    await syncOwnerRolePermissions(database.client);

    const company = await database.client.company.findUniqueOrThrow({
      where: { slug: 'pishteh' },
    });
    pishtehId = company.id;

    const owner = await database.client.user.findUniqueOrThrow({
      where: { email: ownerEmail },
    });
    ownerUserId = owner.id;
    await database.client.user.update({
      where: { id: owner.id },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });

    const membership = await database.client.companyMember.findUniqueOrThrow({
      where: {
        companyId_userId: {
          companyId: pishtehId,
          userId: owner.id,
        },
      },
    });
    ownerMemberId = membership.id;

    const capture =
      (label?: string) =>
      async (event: DomainEvent): Promise<void> => {
        sink.received.push(event);
        if (label) {
          sink.handlerCalls.push(label);
        }
      };

    eventBus.subscribe(DOMAIN_EVENTS.ROLE_CREATED, 'e2e-role-created', capture('created'));
    eventBus.subscribe(DOMAIN_EVENTS.ROLE_PERMISSIONS_CHANGED, 'e2e-role-perms', capture('perms'));
    eventBus.subscribe(DOMAIN_EVENTS.COMPANY_UPDATED, 'e2e-company', capture('company'));
    eventBus.subscribe(DOMAIN_EVENTS.MEMBER_CREATED, 'e2e-member', capture());
    eventBus.subscribe(DOMAIN_EVENTS.MEMBER_STATUS_CHANGED, 'e2e-member-status', capture());
    eventBus.subscribe(DOMAIN_EVENTS.MEMBER_REMOVED, 'e2e-member-removed', capture());
    eventBus.subscribe(DOMAIN_EVENTS.MEMBER_REACTIVATED, 'e2e-member-reactivated', capture());
    eventBus.subscribe(DOMAIN_EVENTS.MEMBER_ROLES_CHANGED, 'e2e-member-roles', capture());
    eventBus.subscribe(DOMAIN_EVENTS.ROLE_UPDATED, 'e2e-role-updated', capture());
    eventBus.subscribe(DOMAIN_EVENTS.ROLE_DELETED, 'e2e-role-deleted', capture());
  });

  beforeEach(() => {
    sink.received = [];
    sink.handlerCalls = [];
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function assertNoSecrets(event: DomainEvent): void {
    const serialized = JSON.stringify(event);
    for (const forbidden of [
      'passwordHash',
      'password',
      'accessToken',
      'refreshToken',
      'refreshTokenHash',
      'Authorization',
      'cookie',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  }

  it('dispatches role.created and role.permissions_changed after commit with context', async () => {
    const ownerToken = await login(ownerEmail);
    const requestId = randomUUID();

    const permissions = await request(app.getHttpServer())
      .get('/api/v1/permissions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);

    const memberRead = (permissions.body.data as Array<{ id: string; key: string }>).find(
      (permission) => permission.key === PERMISSIONS.MEMBER_READ,
    );
    expect(memberRead).toBeTruthy();

    const roleKey = `EVT_${randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .set('x-request-id', requestId)
      .send({ name: 'Event Sales', key: roleKey })
      .expect(201);

    const roleId = created.body.data.id as string;

    const createdEvent = sink.received.find((event) => event.type === DOMAIN_EVENTS.ROLE_CREATED);
    expect(createdEvent).toBeDefined();
    expect(createdEvent!.companyId).toBe(pishtehId);
    expect(createdEvent!.actor?.userId).toBe(ownerUserId);
    expect(createdEvent!.actor?.companyMemberId).toBe(ownerMemberId);
    expect(createdEvent!.requestId).toBe(requestId);
    expect(createdEvent!.correlationId).toBe(requestId);
    expect(createdEvent!.eventId).toBeTruthy();
    expect(createdEvent!.payload).toEqual({ roleId, key: roleKey });
    assertNoSecrets(createdEvent!);

    const auditCreated = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        action: AUDIT_ACTIONS.ROLE_CREATED,
        entityId: roleId,
      },
    });
    expect(auditCreated).toBeTruthy();

    await request(app.getHttpServer())
      .put(`/api/v1/roles/${roleId}/permissions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .set('x-request-id', requestId)
      .send({ permissionIds: [memberRead!.id] })
      .expect(200);

    const permsEvent = sink.received.find(
      (event) => event.type === DOMAIN_EVENTS.ROLE_PERMISSIONS_CHANGED,
    );
    expect(permsEvent).toBeDefined();
    expect(permsEvent!.companyId).toBe(pishtehId);
    expect(permsEvent!.requestId).toBe(requestId);
    expect(permsEvent!.correlationId).toBe(requestId);
    expect(permsEvent!.eventId).not.toBe(createdEvent!.eventId);
    expect(sink.handlerCalls).toEqual(expect.arrayContaining(['created', 'perms']));

    await request(app.getHttpServer())
      .delete(`/api/v1/roles/${roleId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .expect(200);
  });

  it('does not dispatch events on no-op company update', async () => {
    const ownerToken = await login(ownerEmail);
    const beforeCount = sink.received.filter((e) => e.type === DOMAIN_EVENTS.COMPANY_UPDATED)
      .length;

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Pishteh', timezone: 'Asia/Tehran' })
      .expect(200);

    const afterCount = sink.received.filter((e) => e.type === DOMAIN_EVENTS.COMPANY_UPDATED).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('does not dispatch when audit fails and rolls back the mutation', async () => {
    const ownerToken = await login(ownerEmail);
    const companyBefore = await database.client.company.findUniqueOrThrow({
      where: { id: pishtehId },
    });

    const spy = jest
      .spyOn(auditService, 'record')
      .mockRejectedValue(new Error('simulated audit failure'));

    const beforeEvents = sink.received.length;

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: `Pishteh-EvtFail-${randomUUID().slice(0, 4)}` })
      .expect(500);

    spy.mockRestore();

    const companyAfter = await database.client.company.findUniqueOrThrow({
      where: { id: pishtehId },
    });
    expect(companyAfter.name).toBe(companyBefore.name);
    expect(sink.received.length).toBe(beforeEvents);

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Pishteh', timezone: 'Asia/Tehran' })
      .expect(200);
  });

  it('keeps committed mutation when a post-commit handler fails', async () => {
    const ownerToken = await login(ownerEmail);
    const nextName = `Pishteh-Evt-${randomUUID().slice(0, 6)}`;

    eventBus.subscribe(DOMAIN_EVENTS.COMPANY_UPDATED, 'e2e-failing-handler', async () => {
      throw new Error('handler boom');
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: nextName })
      .expect(200);

    const company = await database.client.company.findUniqueOrThrow({
      where: { id: pishtehId },
    });
    expect(company.name).toBe(nextName);

    const audit = await database.client.auditLog.findFirst({
      where: {
        companyId: pishtehId,
        action: AUDIT_ACTIONS.COMPANY_UPDATED,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();

    const companyEvent = sink.received.find(
      (event) => event.type === DOMAIN_EVENTS.COMPANY_UPDATED,
    );
    expect(companyEvent?.payload).toMatchObject({
      companyId: pishtehId,
      changedFields: expect.arrayContaining(['name']),
    });
    assertNoSecrets(companyEvent!);

    await request(app.getHttpServer())
      .patch(`/api/v1/companies/${pishtehId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Company-Id', pishtehId)
      .send({ name: 'Pishteh', timezone: 'Asia/Tehran' })
      .expect(200);
  });
});
