import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { GlobalExceptionFilter } from './http-exception.filter';
import { AppError } from '../exceptions/app.error';
import { ERROR_CODES } from '../constants';

describe('GlobalExceptionFilter', () => {
  const logger = {
    setContext: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as PinoLogger;

  const configService = {
    getOrThrow: jest.fn().mockReturnValue({
      isProduction: true,
    }),
  } as unknown as ConfigService;

  const filter = new GlobalExceptionFilter(logger, configService);

  function createHost() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = {
      method: 'GET',
      url: '/api/v1/example',
      originalUrl: '/api/v1/example',
      header: jest.fn().mockReturnValue(undefined),
    };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as ArgumentsHost;

    return { host, status, json };
  }

  it('formats AppError responses', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new AppError({
        code: ERROR_CODES.CONFLICT,
        message: 'Conflict',
        statusCode: 409,
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: ERROR_CODES.CONFLICT,
          message: 'Conflict',
        }),
      }),
    );
  });

  it('formats HttpException validation arrays', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new HttpException(
        { message: ['email must be an email'], error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Request validation failed',
        }),
      }),
    );
  });

  it('hides unexpected error details in production', () => {
    const { host, status, json } = createHost();

    filter.catch(new Error('secret boom'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: 'An unexpected error occurred',
          details: null,
        }),
      }),
    );
  });
});
