import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import { CurrentCompany } from '../companies/decorators/current-company.decorator';
import {
  ApiCompanyHeader,
  RequireCompany,
} from '../companies/decorators/require-company.decorator';
import type { CompanyContext } from '../companies/types/company.types';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import {
  CreateRoleDto,
  ListRolesQueryDto,
  ReplaceRolePermissionsDto,
  UpdateRoleDto,
} from './dto/roles.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@RequireCompany()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  @ApiOperation({
    summary: 'List roles for the current company',
    description: `Requires \`${PERMISSIONS.ROLE_READ}\`.`,
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListRolesQueryDto) {
    return this.rolesService.list(company, query);
  }

  @Get(':roleId')
  @RequirePermissions(PERMISSIONS.ROLE_READ)
  @ApiOperation({
    summary: 'Get a company role',
    description: `Requires \`${PERMISSIONS.ROLE_READ}\`.`,
  })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    const data = await this.rolesService.getById(company, roleId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ROLE_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a custom company role',
    description: `Requires \`${PERMISSIONS.ROLE_CREATE}\`. System roles cannot be created via API.`,
  })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateRoleDto) {
    const data = await this.rolesService.create(company, body);
    return { data };
  }

  @Patch(':roleId')
  @RequirePermissions(PERMISSIONS.ROLE_UPDATE)
  @ApiOperation({
    summary: 'Update custom role metadata (name/description; key immutable)',
    description: `Requires \`${PERMISSIONS.ROLE_UPDATE}\`.`,
  })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: UpdateRoleDto,
  ) {
    const data = await this.rolesService.update(company, roleId, body);
    return { data };
  }

  @Put(':roleId/permissions')
  @RequirePermissions(PERMISSIONS.ROLE_PERMISSIONS_UPDATE)
  @ApiOperation({
    summary: 'Replace permissions on a custom role',
    description: `Requires \`${PERMISSIONS.ROLE_PERMISSIONS_UPDATE}\` (OWNER-seeded). System role permission sets are code-managed.`,
  })
  async replacePermissions(
    @CurrentCompany() company: CompanyContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: ReplaceRolePermissionsDto,
  ) {
    const data = await this.rolesService.replacePermissions(company, roleId, body);
    return { data };
  }

  @Delete(':roleId')
  @RequirePermissions(PERMISSIONS.ROLE_DELETE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-delete a custom unused role',
    description: `Requires \`${PERMISSIONS.ROLE_DELETE}\`.`,
  })
  async remove(
    @CurrentCompany() company: CompanyContext,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    const data = await this.rolesService.softDelete(company, roleId);
    return { data };
  }
}
