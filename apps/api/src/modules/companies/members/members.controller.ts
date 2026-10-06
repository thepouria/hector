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
import { RequirePermissions } from '../../rbac/decorators/require-permissions.decorator';
import { RolesService } from '../../rbac/roles.service';
import { UpdateMemberRolesDto } from '../../rbac/dto/roles.dto';
import { CurrentCompany } from '../decorators/current-company.decorator';
import { ApiCompanyHeader, RequireCompany } from '../decorators/require-company.decorator';
import { CreateMemberDto } from '../dto/create-member.dto';
import { ListMembersQueryDto } from '../dto/list-members-query.dto';
import { UpdateMemberDto } from '../dto/update-member.dto';
import type { CompanyContext } from '../types/company.types';
import { MembersService } from './members.service';

@ApiTags('members')
@ApiBearerAuth()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@RequireCompany()
@Controller('members')
export class MembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly rolesService: RolesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  @ApiOperation({
    summary: 'List members for the current company context',
    description: `Requires \`${PERMISSIONS.MEMBER_READ}\`.`,
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListMembersQueryDto) {
    return this.membersService.list(company, query);
  }

  @Get(':memberId')
  @RequirePermissions(PERMISSIONS.MEMBER_READ)
  @ApiOperation({
    summary: 'Get a member in the current company context',
    description: `Requires \`${PERMISSIONS.MEMBER_READ}\`.`,
  })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const data = await this.membersService.getById(company, memberId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.MEMBER_CREATE)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add an existing Hector user to the company',
    description: `Requires \`${PERMISSIONS.MEMBER_CREATE}\`.`,
  })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateMemberDto) {
    const data = await this.membersService.create(company, body);
    return { data };
  }

  @Patch(':memberId')
  @RequirePermissions(PERMISSIONS.MEMBER_UPDATE)
  @ApiOperation({
    summary: 'Update member status ACTIVE/SUSPENDED',
    description: `Requires \`${PERMISSIONS.MEMBER_UPDATE}\`.`,
  })
  async updateStatus(
    @CurrentCompany() company: CompanyContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() body: UpdateMemberDto,
  ) {
    const data = await this.membersService.updateStatus(company, memberId, body);
    return { data };
  }

  @Delete(':memberId')
  @RequirePermissions(PERMISSIONS.MEMBER_REMOVE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove member access (status=REMOVED, history preserved)',
    description: `Requires \`${PERMISSIONS.MEMBER_REMOVE}\`.`,
  })
  async remove(
    @CurrentCompany() company: CompanyContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
  ) {
    const data = await this.membersService.remove(company, memberId);
    return { data };
  }

  @Put(':memberId/roles')
  @RequirePermissions(PERMISSIONS.ROLE_ASSIGN)
  @ApiOperation({
    summary: 'Replace member role assignments',
    description: `Requires \`${PERMISSIONS.ROLE_ASSIGN}\`. OWNER role changes require an existing OWNER. Non-owners cannot escalate beyond their own permissions.`,
  })
  async replaceRoles(
    @CurrentCompany() company: CompanyContext,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() body: UpdateMemberRolesDto,
  ) {
    const data = await this.rolesService.replaceMemberRoles(company, memberId, body.roleIds);
    return { data };
  }
}
