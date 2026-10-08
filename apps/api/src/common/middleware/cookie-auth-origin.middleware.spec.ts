import { createCookieAuthOriginGuard } from './cookie-auth-origin.middleware';
import type { Request, Response } from 'express';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('cookieAuthOriginGuard', () => {
  const guard = createCookieAuthOriginGuard(['http://localhost:3000']);

  it('rejects refresh without Origin (fail closed for cookie CSRF)', () => {
    const req = {
      method: 'POST',
      path: '/api/v1/auth/refresh',
      get: () => undefined,
      requestId: 'req-missing',
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('allows login without Origin (password body; API clients)', () => {
    const req = {
      method: 'POST',
      path: '/api/v1/auth/login',
      get: () => undefined,
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it('allows refresh from a trusted Origin', () => {
    const req = {
      method: 'POST',
      path: '/api/v1/auth/refresh',
      get: (header: string) => (header === 'origin' ? 'http://localhost:3000' : undefined),
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it('rejects refresh from an untrusted Origin', () => {
    const req = {
      method: 'POST',
      path: '/api/v1/auth/refresh',
      get: (header: string) => (header === 'origin' ? 'https://evil.example' : undefined),
      requestId: 'req-1',
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('does not apply Origin checks to Bearer company routes', () => {
    const req = {
      method: 'PATCH',
      path: '/api/v1/companies/abc',
      get: (header: string) => (header === 'origin' ? 'https://evil.example' : undefined),
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});
