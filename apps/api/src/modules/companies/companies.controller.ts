import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '../auth/types/auth.types';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CompaniesService } from './companies.service';
import { CurrentCompany } from './decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from './decorators/require-company.decorator';
import { UpdateCompanyDto } from './dto/update-company.dto';
import type { CompanyContext } from './types/company.types';

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @ApiOperation({
    summary: 'List companies for the authenticated user',
    description:
      'Returns only ACTIVE companies with an ACTIVE membership. No X-Company-Id or company.read required.',
  })
  async list(@CurrentUser() principal: AuthPrincipal) {
    const data = await this.companiesService.listForUser(principal.userId);
    return { data };
  }

  @Get(':companyId')
  @RequireCompany()
  @ApiSecurity('company-id')
  @ApiCompanyHeader()
  @RequirePermissions(PERMISSIONS.COMPANY_READ)
  @ApiOperation({
    summary: 'Get the current company profile',
    description: `Requires \`${PERMISSIONS.COMPANY_READ}\` and X-Company-Id matching :companyId.`,
  })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ) {
    const data = await this.companiesService.getInContext(company, companyId);
    return { data };
  }

  @Patch(':companyId')
  @RequireCompany()
  @ApiSecurity('company-id')
  @ApiCompanyHeader()
  @RequirePermissions(PERMISSIONS.COMPANY_UPDATE)
  @ApiOperation({
    summary: 'Update company profile',
    description: `Requires \`${PERMISSIONS.COMPANY_UPDATE}\`. Editable: name, timezone. Immutable: slug, baseCurrency.`,
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() body: UpdateCompanyDto,
  ) {
    const data = await this.companiesService.updateInContext(company, companyId, body);
    return { data };
  }
}
