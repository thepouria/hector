import request from 'supertest';
import {
  UserStatus,
  syncOwnerRolePermissions,
  syncPermissions,
} from '@hector/database';
import type { INestApplication } from '@nestjs/common';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import { createE2eApp, E2E_PASSWORD } from './helpers/e2e-app';

/**
 * Phase 5.5.1 — Party Master foundation (identity only; no Supplier/Customer links).
 */
describe('Parties (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  const ownerEmail = 'pouria@hector.local';
  const password = E2E_PASSWORD;
  let pishtehId: string;
  let demoBId: string;
  let ownerPasswordHash: string;

  beforeAll(async () => {
    app = await createE2eApp();
    database = app.get(DatabaseService);
    await syncPermissions(database.client);
    await syncOwnerRolePermissions(database.client);

    pishtehId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'pishteh' } })
    ).id;
    demoBId = (
      await database.client.company.findUniqueOrThrow({ where: { slug: 'hector-demo-b' } })
    ).id;

    const owner = await database.client.user.update({
      where: { email: ownerEmail },
      data: { status: UserStatus.ACTIVE, deletedAt: null },
    });
    ownerPasswordHash = owner.passwordHash;
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string): Promise<string> {
    await database.client.user.update({
      where: { email: ownerEmail },
      data: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        passwordHash: ownerPasswordHash,
      },
    });
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  function auth(token: string, companyId = pishtehId) {
    return {
      Authorization: `Bearer ${token}`,
      'X-Company-Id': companyId,
    };
  }

  it('denies unauthenticated party access', async () => {
    await request(app.getHttpServer()).get('/api/v1/parties').expect(401);
  });

  it('creates INDIVIDUAL with multi contacts/addresses/roles and preserves leading-zero mobile', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({
        type: 'INDIVIDUAL',
        firstName: 'احمد',
        lastName: 'رضایی',
        nationalId: `NID-${Date.now()}`,
        contacts: [
          { type: 'MOBILE', value: '09121234567', isPrimary: true },
          { type: 'MOBILE', value: '09351234567' },
          { type: 'EMAIL', value: 'Ahmad@Test.example', isPrimary: true },
        ],
        addresses: [
          {
            label: 'Home',
            type: 'HOME',
            addressLine1: 'Tehran',
            isPrimary: true,
          },
          {
            label: 'Office',
            type: 'OFFICE',
            addressLine1: 'Karaj',
          },
        ],
        roles: ['SUPPLIER', 'CUSTOMER', 'PARTNER', 'LENDER'],
      })
      .expect(201);

    const party = created.body.data;
    expect(party.partyCode).toMatch(/^PTY-\d{6,}$/);
    expect(party.displayName).toBe('احمد رضایی');
    expect(party.type).toBe('INDIVIDUAL');
    expect(party.contacts).toHaveLength(3);
    expect(party.contacts.find((c: { value: string }) => c.value === '09121234567')).toBeTruthy();
    expect(party.addresses).toHaveLength(2);
    expect(party.roles.map((r: { roleType: string }) => r.roleType).sort()).toEqual(
      ['CUSTOMER', 'LENDER', 'PARTNER', 'SUPPLIER'].sort(),
    );

    const dupRole = await request(app.getHttpServer())
      .post(`/api/v1/parties/${party.id}/roles`)
      .set(auth(token))
      .send({ roleType: 'SUPPLIER' })
      .expect(409);
    expect(['PARTY_ROLE_ALREADY_ACTIVE', 'CONFLICT']).toContain(dupRole.body.error.code);
  });

  it('creates ORGANIZATION and rejects mass-assigned system fields', async () => {
    const token = await login(ownerEmail);
    // forbidNonWhitelisted: unknown system fields must not be accepted.
    await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({
        type: 'ORGANIZATION',
        legalName: 'ABC Trading LLC',
        tradeName: 'ABC Trading',
        registrationNumber: `REG-${Date.now()}`,
        partyCode: 'HACKED',
        companyId: demoBId,
        status: 'ARCHIVED',
      })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({
        type: 'ORGANIZATION',
        legalName: 'ABC Trading LLC',
        tradeName: 'ABC Trading',
        registrationNumber: `REG-${Date.now()}-ok`,
      })
      .expect(201);

    expect(created.body.data.partyCode).toMatch(/^PTY-\d{6,}$/);
    expect(created.body.data.partyCode).not.toBe('HACKED');
    expect(created.body.data.companyId).toBe(pishtehId);
    expect(created.body.data.status).toBe('ACTIVE');
    expect(created.body.data.displayName).toBe('ABC Trading');
  });

  it('enforces tenant isolation (IDOR)', async () => {
    const token = await login(ownerEmail);
    const foreign = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token, demoBId))
      .send({ type: 'INDIVIDUAL', displayName: `Demo B Person ${Date.now()}` })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/parties/${foreign.body.data.id}`)
      .set(auth(token, pishtehId))
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/parties/${foreign.body.data.id}/contacts`)
      .set(auth(token, pishtehId))
      .send({ type: 'MOBILE', value: '09120000000' })
      .expect(404);
  });

  it('detects potential duplicates without merging', async () => {
    const token = await login(ownerEmail);
    const mobile = `09${String(Date.now()).slice(-9)}`;
    await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({
        type: 'INDIVIDUAL',
        displayName: 'Dup Seed',
        contacts: [{ type: 'MOBILE', value: mobile, isPrimary: true }],
      })
      .expect(201);

    const found = await request(app.getHttpServer())
      .post('/api/v1/parties/potential-duplicates')
      .set(auth(token))
      .send({ mobile })
      .expect(201);

    expect(found.body.data.length).toBeGreaterThanOrEqual(1);
    expect(found.body.data[0].matchedOn).toContain('mobile');
  });

  it('allocates unique party codes under concurrency', async () => {
    const token = await login(ownerEmail);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/parties')
          .set(auth(token))
          .send({ type: 'INDIVIDUAL', displayName: `Race ${i}-${Date.now()}` }),
      ),
    );
    const codes = results.map((r) => {
      expect(r.status).toBe(201);
      return r.body.data.partyCode as string;
    });
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('enforces one primary mobile under concurrent set-primary', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({
        type: 'INDIVIDUAL',
        displayName: 'Primary Race',
        contacts: [
          { type: 'MOBILE', value: '09121110001' },
          { type: 'MOBILE', value: '09121110002' },
        ],
      })
      .expect(201);

    const contacts = created.body.data.contacts as Array<{ id: string }>;
    await Promise.all(
      contacts.map((c) =>
        request(app.getHttpServer())
          .post(`/api/v1/parties/${created.body.data.id}/contacts/${c.id}/primary`)
          .set(auth(token)),
      ),
    );

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/parties/${created.body.data.id}`)
      .set(auth(token))
      .expect(200);

    const primaryMobiles = detail.body.data.contacts.filter(
      (c: { type: string; isPrimary: boolean; status: string }) =>
        c.type === 'MOBILE' && c.isPrimary && c.status === 'ACTIVE',
    );
    expect(primaryMobiles).toHaveLength(1);
  });

  it('allows same display name for different parties', async () => {
    const token = await login(ownerEmail);
    const name = `Same Name ${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({ type: 'INDIVIDUAL', displayName: name })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({ type: 'INDIVIDUAL', displayName: name })
      .expect(201);
  });

  it('lists with role filter, primary contact, and sort without N+1 payload bloat', async () => {
    const token = await login(ownerEmail);
    const stamp = Date.now();
    await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({
        type: 'INDIVIDUAL',
        displayName: `List Filter ${stamp}`,
        contacts: [{ type: 'MOBILE', value: '09129876543', isPrimary: true }],
        roles: ['LENDER'],
      })
      .expect(201);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/parties')
      .query({ role: 'LENDER', search: `List Filter ${stamp}`, sortBy: 'displayName', sortDir: 'asc' })
      .set(auth(token))
      .expect(200);

    expect(listed.body.data.length).toBeGreaterThanOrEqual(1);
    const row = listed.body.data.find((p: { displayName: string }) =>
      p.displayName.includes(`List Filter ${stamp}`),
    );
    expect(row).toBeTruthy();
    expect(row.primaryMobile).toBe('09129876543');
    expect(row.roles).toContain('LENDER');
    expect(row.contacts).toBeUndefined();
    expect(row.addresses).toBeUndefined();
  });

  it('searches Persian name and rejects SQL injection junk safely', async () => {
    const token = await login(ownerEmail);
    const stamp = Date.now();
    await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({ type: 'INDIVIDUAL', firstName: 'احمد', lastName: `تست${stamp}` })
      .expect(201);

    const found = await request(app.getHttpServer())
      .get('/api/v1/parties')
      .query({ search: `احمد تست${stamp}` })
      .set(auth(token))
      .expect(200);
    expect(found.body.data.length).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .get('/api/v1/parties')
      .query({ search: `'; DROP TABLE parties; --` })
      .set(auth(token))
      .expect(200);
  });

  it('classifies duplicate-check matches and never merges', async () => {
    const token = await login(ownerEmail);
    const nid = `NID-DUP-${Date.now()}`;
    const mobile = `09${String(Date.now()).slice(-9)}`;
    const a = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({
        type: 'INDIVIDUAL',
        displayName: 'Dup A',
        nationalId: nid,
        contacts: [{ type: 'MOBILE', value: mobile, isPrimary: true }],
      })
      .expect(201);

    const strong = await request(app.getHttpServer())
      .post('/api/v1/parties/duplicate-check')
      .set(auth(token))
      .send({ nationalId: nid })
      .expect(201);
    expect(strong.body.data[0].matchStrength).toMatch(/EXACT|STRONG/);
    expect(strong.body.data[0].reasonCodes).toContain('NATIONAL_ID_MATCH');

    const potential = await request(app.getHttpServer())
      .post('/api/v1/parties/duplicate-check')
      .set(auth(token))
      .send({ mobile })
      .expect(201);
    expect(potential.body.data[0].matchStrength).toBe('POTENTIAL');

    const nameOnly = await request(app.getHttpServer())
      .post('/api/v1/parties/duplicate-check')
      .set(auth(token))
      .send({ displayName: 'Dup A' })
      .expect(201);
    expect(nameOnly.body.data).toHaveLength(0);

    // Still two distinct parties after duplicate detection (create another with same name).
    await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({ type: 'INDIVIDUAL', displayName: 'Dup A' })
      .expect(201);
    const stillThere = await request(app.getHttpServer())
      .get(`/api/v1/parties/${a.body.data.id}`)
      .set(auth(token))
      .expect(200);
    expect(stillThere.body.data.id).toBe(a.body.data.id);
  });

  it('duplicate-check is tenant scoped', async () => {
    const token = await login(ownerEmail);
    const nid = `NID-TENANT-${Date.now()}`;
    await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token, demoBId))
      .send({ type: 'INDIVIDUAL', displayName: 'Secret B', nationalId: nid })
      .expect(201);

    const check = await request(app.getHttpServer())
      .post('/api/v1/parties/duplicate-check')
      .set(auth(token, pishtehId))
      .send({ nationalId: nid })
      .expect(201);
    expect(check.body.data).toHaveLength(0);
  });

  it('returns permission-aware related entities without finance leak', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({ type: 'INDIVIDUAL', displayName: `Related ${Date.now()}`, roles: ['PARTNER'] })
      .expect(201);

    const related = await request(app.getHttpServer())
      .get(`/api/v1/parties/${created.body.data.id}/related-entities`)
      .set(auth(token))
      .expect(200);

    expect(related.body.data).toHaveProperty('omitted');
    expect(related.body.data).toHaveProperty('supplier');
    expect(related.body.data).toHaveProperty('customer');
    expect(related.body.data).toHaveProperty('loansAsLender');
    expect(related.body.data).toHaveProperty('capitalContributions');
  });

  it('archives only when no active domain relationships block it', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({ type: 'INDIVIDUAL', displayName: `Archive Me ${Date.now()}` })
      .expect(201);

    const archived = await request(app.getHttpServer())
      .post(`/api/v1/parties/${created.body.data.id}/archive`)
      .set(auth(token))
      .expect(201);
    expect(archived.body.data.status).toBe('ARCHIVED');

    await request(app.getHttpServer())
      .patch(`/api/v1/parties/${created.body.data.id}`)
      .set(auth(token))
      .send({ displayName: 'Nope' })
      .expect(409);
  });

  it('blocks deactivating SUPPLIER role while Supplier domain row is active', async () => {
    const token = await login(ownerEmail);
    const stamp = Date.now();
    const partyRes = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({
        type: 'ORGANIZATION',
        legalName: `Role Block Co ${stamp}`,
        roles: ['SUPPLIER'],
      })
      .expect(201);
    const party = partyRes.body.data;

    await request(app.getHttpServer())
      .post('/api/v1/purchasing/suppliers')
      .set(auth(token))
      .send({
        name: `Role Block Co ${stamp}`,
        partyId: party.id,
      })
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/parties/${party.id}`)
      .set(auth(token))
      .expect(200);
    const supplierRole = detail.body.data.roles.find(
      (r: { roleType: string; status: string }) =>
        r.roleType === 'SUPPLIER' && r.status === 'ACTIVE',
    );
    expect(supplierRole).toBeTruthy();

    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/parties/${party.id}/roles/${supplierRole.id}/deactivate`)
      .set(auth(token))
      .expect(409);
    expect(blocked.body.error.code).toBe('PARTY_ROLE_DOMAIN_LINKED');
  });

  it('rejects immutable partyCode / mass assignment on update', async () => {
    const token = await login(ownerEmail);
    const created = await request(app.getHttpServer())
      .post('/api/v1/parties')
      .set(auth(token))
      .send({ type: 'INDIVIDUAL', displayName: `Mass ${Date.now()}` })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/parties/${created.body.data.id}`)
      .set(auth(token))
      .send({ partyCode: 'HACK', companyId: demoBId, status: 'ARCHIVED' })
      .expect(400);
  });
});
