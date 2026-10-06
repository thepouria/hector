import { apiRequest } from '../api/client';
import { tokenStore } from '../auth/token-store';
import type { AuthSession, User } from '@/types/api';

type LoginResponse = {
  data: {
    user: User;
    accessToken: string;
    expiresIn: number;
  };
};

type RefreshResponse = {
  data: {
    accessToken: string;
    expiresIn: number;
  };
};

type MeResponse = {
  data: User;
};

export async function loginRequest(email: string, password: string): Promise<LoginResponse['data']> {
  const result = await apiRequest<LoginResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    skipAuth: true,
    credentials: 'include',
  });
  tokenStore.set(result.data.accessToken);
  return result.data;
}

export async function refreshSession(): Promise<string | null> {
  try {
    const result = await apiRequest<RefreshResponse>('/api/v1/auth/refresh', {
      method: 'POST',
      skipAuth: true,
      credentials: 'include',
    });
    tokenStore.set(result.data.accessToken);
    return result.data.accessToken;
  } catch {
    tokenStore.clear();
    return null;
  }
}

export async function fetchCurrentUser(): Promise<User> {
  const result = await apiRequest<MeResponse>('/api/v1/auth/me');
  return result.data;
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' });
  } finally {
    tokenStore.clear();
  }
}

export async function fetchSessions(): Promise<AuthSession[]> {
  const result = await apiRequest<{ data: AuthSession[] }>('/api/v1/auth/sessions');
  return result.data;
}

export async function revokeSessionRequest(sessionId: string): Promise<void> {
  await apiRequest(`/api/v1/auth/sessions/${sessionId}`, {
    method: 'DELETE',
  });
}

export async function logoutAllRequest(): Promise<number> {
  const result = await apiRequest<{ data: { success: boolean; revokedCount: number } }>(
    '/api/v1/auth/logout-all',
    { method: 'POST' },
  );
  tokenStore.clear();
  return result.data.revokedCount;
}
