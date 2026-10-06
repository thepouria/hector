import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import {
  ApiCompanyHeader,
  RequireCompany,
} from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { AuthorizationService } from './authorization.service';

@ApiTags('me')
@ApiBearerAuth()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@RequireCompany()
@Controller('me')
export class MeAuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @Get('authorization')
  @ApiOperation({
    summary: 'Return the current member roles and effective permissions for the company context',
    description:
      'Requires authentication and X-Company-Id. Frontend checks are UX-only; backend guards remain authoritative.',
  })
  async authorization(@CurrentCompany() company: CompanyContext) {
    const [roles, permissions] = await Promise.all([
      this.authorizationService.getMemberRoles(company.companyMemberId),
      this.authorizationService.getEffectivePermissions(company.companyMemberId),
    ]);

    return {
      data: {
        companyId: company.companyId,
        companyMemberId: company.companyMemberId,
        roles,
        permissions,
      },
    };
  }
}
