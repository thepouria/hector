import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { COMPANY_ID_HEADER, REQUIRE_COMPANY_KEY } from '../../../common/constants';
import { setCompanyContext } from '../../../common/context/request-context';
import { AppError } from '../../../common/exceptions/app.error';
import { ERROR_CODES } from '../../../common/constants';
import type { CompanyScopedRequest } from '../decorators/current-company.decorator';
import { CompanyContextService } from '../company-context.service';

@Injectable()
export class CompanyContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly companyContextService: CompanyContextService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requireCompany = this.reflector.getAllAndOverride<boolean>(REQUIRE_COMPANY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requireCompany) {
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

    const headerValue = request.headers[COMPANY_ID_HEADER];
    const companyIdHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    const company = await this.companyContextService.resolve(
      request.auth.userId,
      companyIdHeader,
    );

    request.company = company;
    setCompanyContext(company.companyId, company.companyMemberId);

    return true;
  }
}
