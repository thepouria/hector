export type ApiError = {
  status: number;
  code?: string;
  message: string;
  requestId?: string | null;
  details?: unknown;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string | null;
  readonly details?: unknown;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiClientError';
    this.status = error.status;
    this.code = error.code;
    this.requestId = error.requestId;
    this.details = error.details;
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}
