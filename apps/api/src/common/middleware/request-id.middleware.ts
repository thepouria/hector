import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from '../constants';
import { requestContext } from '../context/request-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RequestWithId = Request & {
  requestId?: string;
  id?: string;
};

function resolveRequestId(req: Request): string {
  const incoming = req.header(REQUEST_ID_HEADER)?.trim();
  if (incoming && UUID_RE.test(incoming)) {
    return incoming;
  }

  return randomUUID();
}

/**
 * Assigns a correlation ID to each request, returns it on the response,
 * and stores it in AsyncLocalStorage for logging/errors.
 */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req);

  req.requestId = requestId;
  req.id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const userAgentHeader = req.headers?.['user-agent'];

  requestContext.run(
    {
      requestId,
      ipAddress: req.ip ?? null,
      userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : null,
    },
    () => {
      next();
    },
  );
}
