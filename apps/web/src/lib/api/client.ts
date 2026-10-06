import { tokenStore } from '../auth/token-store';
import { ApiClientError } from './errors';

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Include X-Company-Id from active company resolution. */
  companyId?: string | null;
  /** Skip Authorization header (login/refresh). */
  skipAuth?: boolean;
  /** Force credentials include (cookies) — default true for refresh path. */
  credentials?: RequestCredentials;
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

function getApiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_API_URL is not configured.');
  }
  return url.replace(/\/$/, '');
}

type ErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  requestId?: string | null;
};

async function parseError(response: Response): Promise<ApiClientError> {
  let body: ErrorBody | null = null;
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    body = null;
  }

  return new ApiClientError({
    status: response.status,
    code: body?.error?.code,
    message: body?.error?.message ?? defaultMessage(response.status),
    requestId: body?.requestId ?? response.headers.get('x-request-id'),
    details: body?.error?.details,
  });
}

function defaultMessage(status: number): string {
  if (status === 401) return 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.';
  if (status === 403) return 'شما دسترسی لازم برای این عملیات را ندارید.';
  if (status === 404) return 'مورد درخواستی پیدا نشد.';
  if (status >= 500) return 'مشکلی در سرور پیش آمد. دوباره تلاش کنید.';
  return 'درخواست با خطا مواجه شد.';
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/v1/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        tokenStore.clear();
        return null;
      }

      const json = (await response.json()) as { data?: { accessToken?: string } };
      const token = json.data?.accessToken ?? null;
      tokenStore.set(token);
      return token;
    } catch {
      tokenStore.clear();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (!options.skipAuth) {
    const token = tokenStore.get();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  if (options.companyId) {
    headers['X-Company-Id'] = options.companyId;
  }

  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

  const doFetch = async (): Promise<Response> =>
    fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: options.credentials ?? 'include',
      signal: options.signal,
    });

  let response = await doFetch();

  // Attempt one silent refresh on 401 for authenticated calls.
  if (response.status === 401 && !options.skipAuth && !path.includes('/auth/login')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.Authorization = `Bearer ${refreshed}`;
      response = await doFetch();
    }
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export { refreshAccessToken, getApiBaseUrl };
