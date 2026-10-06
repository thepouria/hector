import { ERROR_CODES, type ErrorCode } from '../constants';

export type AppErrorOptions = {
  code: ErrorCode;
  message: string;
  statusCode?: number;
  details?: unknown;
};

/**
 * Lightweight application error for intentional API failures.
 * Domain modules in later phases can throw this for consistent filtering.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(options: AppErrorOptions) {
    super(options.message);
    this.name = 'AppError';
    this.code = options.code;
    this.statusCode = options.statusCode ?? 400;
    this.details = options.details ?? null;
  }

  static validation(message = 'Request validation failed', details: unknown = null): AppError {
    return new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      statusCode: 400,
      details,
    });
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError({
      code: ERROR_CODES.NOT_FOUND,
      message,
      statusCode: 404,
    });
  }

  static conflict(message = 'The requested resource conflicts with an existing record.'): AppError {
    return new AppError({
      code: ERROR_CODES.CONFLICT,
      message,
      statusCode: 409,
    });
  }
}
