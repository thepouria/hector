import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContextStore = {
  requestId: string;
  userId?: string;
  sessionId?: string;
  companyId?: string;
  companyMemberId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getRequestContext(): RequestContextStore | undefined {
  return requestContext.getStore();
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

export function setAuthenticatedContext(userId: string, sessionId: string): void {
  const store = requestContext.getStore();
  if (!store) {
    return;
  }

  store.userId = userId;
  store.sessionId = sessionId;
}

export function setCompanyContext(companyId: string, companyMemberId: string): void {
  const store = requestContext.getStore();
  if (!store) {
    return;
  }

  store.companyId = companyId;
  store.companyMemberId = companyMemberId;
}
