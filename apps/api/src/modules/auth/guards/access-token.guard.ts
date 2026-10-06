import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ERROR_CODES, IS_PUBLIC_KEY } from '../../../common/constants';
import { setAuthenticatedContext } from '../../../common/context/request-context';
import { AppError } from '../../../common/exceptions/app.error';
import { AUTH_ERROR_MESSAGES } from '../auth.constants';
import { AuthService } from '../auth.service';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';
import { AccessTokenService } from '../tokens/access-token.service';
import type { AuthPrincipal } from '../types/auth.types';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokenService: AccessTokenService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = this.extractBearer(authorization);

    if (!token) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHENTICATED,
        message: AUTH_ERROR_MESSAGES.UNAUTHENTICATED,
        statusCode: 401,
      });
    }

    let claims;
    try {
      claims = await this.accessTokenService.verify(token);
    } catch {
      throw new AppError({
        code: ERROR_CODES.INVALID_ACCESS_TOKEN,
        message: AUTH_ERROR_MESSAGES.INVALID_ACCESS_TOKEN,
        statusCode: 401,
      });
    }

    const principal: AuthPrincipal = {
      userId: claims.sub,
      sessionId: claims.sid,
    };

    await this.authService.assertPrincipalActive(principal);

    request.auth = principal;
    setAuthenticatedContext(principal.userId, principal.sessionId);

    return true;
  }

  private extractBearer(authorization: string | undefined): string | null {
    if (!authorization) {
      return null;
    }

    const [scheme, token] = authorization.split(' ');
    if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
      return null;
    }

    return token.trim() || null;
  }
}
