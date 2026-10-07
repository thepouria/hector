import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { AddReconciliationDiscrepancyDto } from './dto/add-reconciliation-discrepancy.dto';
import { CreateReconciliationDto } from './dto/create-reconciliation.dto';
import { ListReconciliationCandidatesQueryDto } from './dto/list-reconciliation-candidates.query.dto';
import { ListReconciliationsQueryDto } from './dto/list-reconciliations.query.dto';
import { MatchReconciliationDto } from './dto/match-reconciliation.dto';
import { ResolveReconciliationDto } from './dto/resolve-reconciliation.dto';
import { ReverseReconciliationMatchDto } from './dto/reverse-reconciliation-match.dto';
import { ReconciliationsService } from './reconciliations.service';

@ApiTags('reconciliations')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('reconciliations')
export class ReconciliationsController {
  constructor(private readonly reconciliations: ReconciliationsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_MATCH)
  @ApiOperation({ summary: 'Open reconciliation case for a canonical source' })
  async open(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: CreateReconciliationDto,
  ) {
    return { data: await this.reconciliations.open(company, dto) };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_READ)
  @ApiOperation({ summary: 'List reconciliations' })
  async list(
    @CurrentCompany() company: CompanyContext,
    @Query() query: ListReconciliationsQueryDto,
  ) {
    return this.reconciliations.list(company, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_READ)
  @ApiOperation({ summary: 'Get reconciliation (expected vs matched vs difference)' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.reconciliations.get(company, id) };
  }

  @Get(':id/candidates')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_READ)
  @ApiOperation({ summary: 'Suggest Finance transaction candidates (read-only)' })
  async candidates(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListReconciliationCandidatesQueryDto,
  ) {
    return this.reconciliations.listCandidates(company, id, query);
  }

  @Post(':id/match')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_MATCH)
  @HttpCode(200)
  @ApiOperation({ summary: 'Match via canonical Settlement Allocation' })
  async match(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MatchReconciliationDto,
  ) {
    return { data: await this.reconciliations.match(company, id, dto) };
  }

  @Post(':id/reverse-match')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_REVERSE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Reverse a settlement allocation match' })
  async reverseMatch(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseReconciliationMatchDto,
  ) {
    return { data: await this.reconciliations.reverseMatch(company, id, dto) };
  }

  @Post(':id/close-matching')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_MATCH)
  @HttpCode(200)
  @ApiOperation({ summary: 'Declare matching complete and detect discrepancy if any' })
  async closeMatching(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.reconciliations.closeMatching(company, id) };
  }

  @Post(':id/discrepancies')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_REVIEW)
  @ApiOperation({ summary: 'Add discrepancy reason line' })
  async addDiscrepancy(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddReconciliationDiscrepancyDto,
  ) {
    return { data: await this.reconciliations.addDiscrepancy(company, id, dto) };
  }

  @Post(':id/under-review')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_REVIEW)
  @HttpCode(200)
  @ApiOperation({ summary: 'Move discrepancy under review' })
  async underReview(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.reconciliations.moveUnderReview(company, id) };
  }

  @Post(':id/resolve')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_RESOLVE)
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve discrepancy (preserves historical difference)' })
  async resolve(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReconciliationDto,
  ) {
    return { data: await this.reconciliations.resolve(company, id, dto) };
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILIATION_MATCH)
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel reconciliation case' })
  async cancel(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.reconciliations.cancel(company, id) };
  }
}
