import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@hector/database';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES, type ErrorCode } from '../constants';
import { getRequestId } from '../context/request-context';
import { AppError } from '../exceptions/app.error';
import type { AppConfig } from '../../config';

export type HectorErrorBody = {
  error: {
    code: ErrorCode | string;
    message: string;
    details: unknown;
  };
  requestId: string | null;
};

@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {
    this.logger.setContext(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = getRequestId() ?? request.header('x-request-id') ?? null;
    const appConfig = this.configService.getOrThrow<AppConfig>('app');

    const mapped = this.mapException(exception, appConfig.isProduction);
    const body: HectorErrorBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        details: mapped.details,
      },
      requestId,
    };

    if (mapped.statusCode >= 500) {
      this.logger.error(
        {
          requestId,
          method: request.method,
          path: request.originalUrl ?? request.url,
          err: exception instanceof Error ? exception : undefined,
          errorName: exception instanceof Error ? exception.name : typeof exception,
          errorMessage: exception instanceof Error ? exception.message : String(exception),
        },
        'Unhandled server error',
      );
    } else if (mapped.statusCode >= 400) {
      this.logger.warn(
        {
          requestId,
          method: request.method,
          path: request.originalUrl ?? request.url,
          code: mapped.code,
          statusCode: mapped.statusCode,
        },
        mapped.message,
      );
    }

    response.status(mapped.statusCode).json(body);
  }

  private mapException(
    exception: unknown,
    isProduction: boolean,
  ): {
    statusCode: number;
    code: ErrorCode | string;
    message: string;
    details: unknown;
  } {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.statusCode,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const validationDetails = this.extractValidationDetails(exceptionResponse);

      if (validationDetails) {
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Request validation failed',
          details: validationDetails,
        };
      }

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : typeof exceptionResponse === 'object' &&
              exceptionResponse !== null &&
              'message' in exceptionResponse
            ? Array.isArray((exceptionResponse as { message: unknown }).message)
              ? 'Request failed'
              : String((exceptionResponse as { message: unknown }).message)
            : exception.message;

      return {
        statusCode,
        code: this.codeFromStatus(statusCode),
        message,
        details: null,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaError(exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: isProduction ? 'An unexpected error occurred' : this.safeErrorMessage(exception),
      details: null,
    };
  }

  private mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    code: ErrorCode;
    message: string;
    details: null;
  } {
    switch (error.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'The requested resource conflicts with an existing record.',
          details: null,
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: ERROR_CODES.NOT_FOUND,
          message: 'Resource not found',
          details: null,
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: ERROR_CODES.BAD_REQUEST,
          message: 'The request references a related record that does not exist.',
          details: null,
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: 'A database error occurred',
          details: null,
        };
    }
  }

  private extractValidationDetails(exceptionResponse: string | object): Array<{
    field: string;
    message: string;
  }> | null {
    if (typeof exceptionResponse !== 'object' || exceptionResponse === null) {
      return null;
    }

    const message = (exceptionResponse as { message?: unknown }).message;
    if (!Array.isArray(message)) {
      return null;
    }

    return message.map((item) => {
      if (typeof item === 'string') {
        return { field: 'request', message: item };
      }

      return { field: 'request', message: String(item) };
    });
  }

  private codeFromStatus(statusCode: number): ErrorCode {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.BAD_REQUEST;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ERROR_CODES.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ERROR_CODES.SERVICE_UNAVAILABLE;
      default:
        return statusCode >= 500 ? ERROR_CODES.INTERNAL_SERVER_ERROR : ERROR_CODES.BAD_REQUEST;
    }
  }

  private safeErrorMessage(exception: unknown): string {
    if (exception instanceof Error) {
      return exception.message;
    }

    return 'An unexpected error occurred';
  }
}
