import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { CapitalContributionsService } from './capital-contributions.service';
import {
  CreateCapitalContributionDto,
  ListCapitalContributionsQueryDto,
  UpdateCapitalContributionDto,
} from './dto/capital-contribution.dto';

@ApiTags('finance-capital-contributions')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('finance/capital-contributions')
export class CapitalContributionsController {
  constructor(private readonly capitalService: CapitalContributionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_CAPITAL_READ)
  @ApiOperation({ summary: 'List capital contributions' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListCapitalContributionsQueryDto,
  ) {
    return this.capitalService.list(company, query);
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.FINANCE_CAPITAL_READ)
  @ApiOperation({ summary: 'Capital equity summary by currency (no FX aggregation)' })
  async summary(@CurrentCompany() company: CompanyContext) {
    const data = await this.capitalService.summary(company);
    return { data };
  }

  @Get(':contributionId')
  @RequirePermissions(PERMISSIONS.FINANCE_CAPITAL_READ)
  @ApiOperation({ summary: 'Get capital contribution detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
  ) {
    const data = await this.capitalService.get(company, contributionId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_CAPITAL_MANAGE)
  @ApiOperation({ summary: 'Create capital contribution (optionally post immediately)' })
  async create(
    @CurrentCompany() company: CompanyContext,
    @Body() body: CreateCapitalContributionDto,
  ) {
    const data = await this.capitalService.create(company, body);
    return { data };
  }

  @Patch(':contributionId')
  @RequirePermissions(PERMISSIONS.FINANCE_CAPITAL_MANAGE)
  @ApiOperation({ summary: 'Update DRAFT capital contribution' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
    @Body() body: UpdateCapitalContributionDto,
  ) {
    const data = await this.capitalService.update(company, contributionId, body);
    return { data };
  }

  @Post(':contributionId/post')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_CAPITAL_MANAGE)
  @ApiOperation({ summary: 'Post capital contribution → MONEY_IN CAPITAL_INJECTION' })
  async post(
    @CurrentCompany() company: CompanyContext,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
  ) {
    const data = await this.capitalService.post(company, contributionId);
    return { data };
  }

  @Post(':contributionId/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_CAPITAL_MANAGE)
  @ApiOperation({ summary: 'Cancel DRAFT capital contribution' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
  ) {
    const data = await this.capitalService.cancel(company, contributionId);
    return { data };
  }

  @Post(':contributionId/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.FINANCE_CAPITAL_MANAGE)
  @ApiOperation({ summary: 'Reverse POSTED capital contribution' })
  async reverse(
    @CurrentCompany() company: CompanyContext,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
  ) {
    const data = await this.capitalService.reverse(company, contributionId);
    return { data };
  }
}
