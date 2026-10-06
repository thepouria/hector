import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@hector/database';
import { PinoLogger } from 'nestjs-pino';
import { ERROR_CODES, REQUIRE_PERMISSIONS_KEY } from '../../../common/constants';
import { AppError } from '../../../common/exceptions/app.error';
import type { CompanyScopedRequest } from '../../companies/decorators/current-company.decorator';
import { AuthorizationService } from '../authorization.service';
import { RBAC_ERROR_MESSAGES } from '../rbac.constants';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PermissionsGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<CompanyScopedRequest>();

    if (!request.auth) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: 'Authentication is required.',
        statusCode: 401,
      });
    }

    if (!request.company) {
      throw new AppError({
        code: ERROR_CODES.COMPANY_CONTEXT_REQUIRED,
        message: 'A company context is required for this request.',
        statusCode: 400,
      });
    }

    const allowed = await this.authorizationService.hasAllPermissions(
      request.company.companyMemberId,
      required,
    );

    if (!allowed) {
      this.logger.warn({
        userId: request.auth.userId,
        companyId: request.company.companyId,
        companyMemberId: request.company.companyMemberId,
        required,
        method: request.method,
        path: request.originalUrl ?? request.url,
        msg: 'Permission check failed',
      });

      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: RBAC_ERROR_MESSAGES.FORBIDDEN,
        statusCode: 403,
      });
    }

    return true;
  }
}
