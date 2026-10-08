import type { NextFunction, Request, Response } from 'express';

/**
 * CSRF defense-in-depth for cookie-authenticated auth routes.
 *
 * Hector access tokens are Bearer (not cookie), so most API mutations are not CSRF-vulnerable.
 * Refresh (and other /api/v1/auth cookie flows) use HttpOnly cookies + SameSite=Lax.
 * This middleware rejects state-changing auth requests whose Origin/Referer is missing
 * or not in the trusted CORS allowlist (fail closed for browser cookie POSTs).
 *
 * Login remains Origin-optional when neither Origin nor Referer is sent (API clients /
 * e2e password posts). Browsers still send Origin on cross-origin POSTs.
 */
export function createCookieAuthOriginGuard(trustedOrigins: string[]) {
  const allow = new Set(trustedOrigins);

  return function cookieAuthOriginGuard(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!isCookieAuthStateChange(req)) {
      next();
      return;
    }

    const origin = resolveRequestOrigin(req);
    const path = normalizedPath(req);
    const requireOrigin = path !== '/api/v1/auth/login';

    if (!origin) {
      if (requireOrigin) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Origin is required for this request.',
            details: null,
          },
          requestId: (req as Request & { requestId?: string }).requestId ?? null,
        });
        return;
      }
      next();
      return;
    }

    if (allow.has(origin)) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Origin is not allowed for this request.',
        details: null,
      },
      requestId: (req as Request & { requestId?: string }).requestId ?? null,
    });
  };
}

function isCookieAuthStateChange(req: Request): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    return false;
  }

  const path = normalizedPath(req);
  return (
    path === '/api/v1/auth/login' ||
    path === '/api/v1/auth/refresh' ||
    path === '/api/v1/auth/logout' ||
    path === '/api/v1/auth/logout-all' ||
    path.startsWith('/api/v1/auth/sessions')
  );
}

function normalizedPath(req: Request): string {
  return (req.path || req.url || '').split('?')[0] ?? '';
}

function resolveRequestOrigin(req: Request): string | null {
  const origin = req.get('origin');
  if (origin) {
    return origin;
  }

  const referer = req.get('referer');
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
