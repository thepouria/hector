import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from '../types/auth.types';

export type AuthenticatedRequest = Request & {
  auth?: AuthPrincipal;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new Error('CurrentUser decorator used without authenticated request');
    }

    return request.auth;
  },
);
