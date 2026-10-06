import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { requestIdMiddleware, type RequestWithId } from './request-id.middleware';
import { getRequestId } from '../context/request-context';

describe('requestIdMiddleware', () => {
  it('generates a request id when none is provided', () => {
    const req = {
      header: jest.fn().mockReturnValue(undefined),
      headers: {},
      ip: '127.0.0.1',
    } as unknown as RequestWithId;
    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;

    let seenInsideContext: string | undefined;

    requestIdMiddleware(req, res, () => {
      seenInsideContext = getRequestId();
    });

    expect(req.requestId).toBeDefined();
    expect(seenInsideContext).toBe(req.requestId);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
  });

  it('reuses a valid incoming request id', () => {
    const requestId = randomUUID();
    const req = {
      header: jest.fn().mockReturnValue(requestId),
      headers: { 'user-agent': 'jest' },
      ip: '127.0.0.1',
    } as unknown as RequestWithId;
    const res = {
      setHeader: jest.fn(),
    } as unknown as Response;

    requestIdMiddleware(req, res, () => undefined);

    expect(req.requestId).toBe(requestId);
  });
});
