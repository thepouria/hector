import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from '../../auth/types/auth.types';
import type { CompanyContext } from '../types/company.types';

export type CompanyScopedRequest = Request & {
  auth?: AuthPrincipal;
  company?: CompanyContext;
};

export const CurrentCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CompanyContext => {
    const request = ctx.switchToHttp().getRequest<CompanyScopedRequest>();
    if (!request.company) {
      throw new Error('CurrentCompany decorator used without company context');
    }

    return request.company;
  },
);
