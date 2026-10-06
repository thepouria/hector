import type { NextFunction, Request, Response } from 'express';

/**
 * Authenticated API responses must not be cached by shared intermediaries.
 * Health remains cacheable by default (no-store only under /api).
 */
export function noStoreApiCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const path = req.path || req.url || '';
  if (path.startsWith('/api/') || path === '/health') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
}
