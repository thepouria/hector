import {
  Body,
  Controller,
  Get,
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
import { AuthorizationService } from '../rbac/authorization.service';
import { AddPartyRoleDto } from './dto/add-party-role.dto';
import { CreatePartyDto } from './dto/create-party.dto';
import { PartyDuplicateCheckDto } from './dto/duplicate-check.dto';
import { ListPartiesQueryDto } from './dto/list-parties.query.dto';
import { CreatePartyAddressDto, UpdatePartyAddressDto } from './dto/party-address.dto';
import { CreatePartyContactDto, UpdatePartyContactDto } from './dto/party-contact.dto';
import { UpdatePartyDto } from './dto/update-party.dto';
import { PartiesService } from './parties.service';

@ApiTags('parties')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('parties')
export class PartiesController {
  constructor(
    private readonly parties: PartiesService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PARTY_READ)
  @ApiOperation({ summary: 'List parties' })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListPartiesQueryDto) {
    return this.parties.list(company, query);
  }

  @Post('duplicate-check')
  @RequirePermissions(PERMISSIONS.PARTY_READ)
  @ApiOperation({
    summary: 'Find potential duplicates (read-only; never merges)',
    description:
      'Tenant-scoped. Name-only never matches. Strong ID conflicts are classified EXACT/STRONG; contact matches are POTENTIAL.',
  })
  async duplicateCheck(
    @CurrentCompany() company: CompanyContext,
    @Body() body: PartyDuplicateCheckDto,
  ) {
    return { data: await this.parties.findPotentialDuplicates(company, body) };
  }

  /** @deprecated Prefer POST /parties/duplicate-check */
  @Post('potential-duplicates')
  @RequirePermissions(PERMISSIONS.PARTY_READ)
  @ApiOperation({
    summary: 'Find potential duplicates (alias)',
    deprecated: true,
  })
  async findPotentialDuplicates(
    @CurrentCompany() company: CompanyContext,
    @Body() body: PartyDuplicateCheckDto,
  ) {
    return { data: await this.parties.findPotentialDuplicates(company, body) };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PARTY_CREATE)
  @ApiOperation({ summary: 'Create party (identity master)' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreatePartyDto) {
    return { data: await this.parties.create(company, body) };
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PARTY_READ)
  @ApiOperation({ summary: 'Get party detail' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.parties.get(company, id) };
  }

  @Get(':id/related-entities')
  @RequirePermissions(PERMISSIONS.PARTY_READ)
  @ApiOperation({
    summary: 'Related domain entity summaries (permission-aware)',
    description:
      'Purchasing/Sales/Finance sections omitted when the caller lacks domain read permissions. Never bypasses domain RBAC.',
  })
  async relatedEntities(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const permissions = await this.authorization.getEffectivePermissions(company.companyMemberId);
    return { data: await this.parties.getRelatedEntities(company, id, permissions) };
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PARTY_UPDATE)
  @ApiOperation({ summary: 'Update party identity fields' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePartyDto,
  ) {
    return { data: await this.parties.updateIdentity(company, id, body) };
  }

  @Post(':id/activate')
  @RequirePermissions(PERMISSIONS.PARTY_STATUS)
  @ApiOperation({ summary: 'Activate party' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.parties.activate(company, id) };
  }

  @Post(':id/deactivate')
  @RequirePermissions(PERMISSIONS.PARTY_STATUS)
  @ApiOperation({ summary: 'Deactivate party' })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.parties.deactivate(company, id) };
  }

  @Post(':id/archive')
  @RequirePermissions(PERMISSIONS.PARTY_STATUS)
  @ApiOperation({ summary: 'Archive party (no hard delete)' })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { data: await this.parties.archive(company, id) };
  }

  @Post(':id/contacts')
  @RequirePermissions(PERMISSIONS.PARTY_CONTACTS_MANAGE)
  @ApiOperation({ summary: 'Add party contact point' })
  async addContact(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreatePartyContactDto,
  ) {
    return { data: await this.parties.addContact(company, id, body) };
  }

  @Patch(':id/contacts/:contactId')
  @RequirePermissions(PERMISSIONS.PARTY_CONTACTS_MANAGE)
  @ApiOperation({ summary: 'Update party contact point' })
  async updateContact(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() body: UpdatePartyContactDto,
  ) {
    return { data: await this.parties.updateContact(company, id, contactId, body) };
  }

  @Post(':id/contacts/:contactId/primary')
  @RequirePermissions(PERMISSIONS.PARTY_CONTACTS_MANAGE)
  @ApiOperation({ summary: 'Set primary contact for its type' })
  async setPrimaryContact(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    return { data: await this.parties.setPrimaryContact(company, id, contactId) };
  }

  @Post(':id/contacts/:contactId/deactivate')
  @RequirePermissions(PERMISSIONS.PARTY_CONTACTS_MANAGE)
  @ApiOperation({ summary: 'Deactivate party contact point' })
  async deactivateContact(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    return { data: await this.parties.deactivateContact(company, id, contactId) };
  }

  @Post(':id/addresses')
  @RequirePermissions(PERMISSIONS.PARTY_ADDRESSES_MANAGE)
  @ApiOperation({ summary: 'Add party address' })
  async addAddress(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreatePartyAddressDto,
  ) {
    return { data: await this.parties.addAddress(company, id, body) };
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermissions(PERMISSIONS.PARTY_ADDRESSES_MANAGE)
  @ApiOperation({ summary: 'Update party address' })
  async updateAddress(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() body: UpdatePartyAddressDto,
  ) {
    return { data: await this.parties.updateAddress(company, id, addressId, body) };
  }

  @Post(':id/addresses/:addressId/primary')
  @RequirePermissions(PERMISSIONS.PARTY_ADDRESSES_MANAGE)
  @ApiOperation({ summary: 'Set primary party address' })
  async setPrimaryAddress(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return { data: await this.parties.setPrimaryAddress(company, id, addressId) };
  }

  @Post(':id/addresses/:addressId/archive')
  @RequirePermissions(PERMISSIONS.PARTY_ADDRESSES_MANAGE)
  @ApiOperation({ summary: 'Archive party address' })
  async archiveAddress(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return { data: await this.parties.archiveAddress(company, id, addressId) };
  }

  @Post(':id/roles')
  @RequirePermissions(PERMISSIONS.PARTY_ROLES_MANAGE)
  @ApiOperation({
    summary: 'Add active business role capacity to party',
    description:
      'Adds PartyRole capacity only. Creating Supplier/Customer/Partner domain records remains in owning domains.',
  })
  async addRole(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddPartyRoleDto,
  ) {
    return { data: await this.parties.addRole(company, id, body) };
  }

  @Post(':id/roles/:roleId/deactivate')
  @RequirePermissions(PERMISSIONS.PARTY_ROLES_MANAGE)
  @ApiOperation({
    summary: 'Deactivate party role (preserve history)',
    description: 'Blocked while an active domain relationship still exists for that role.',
  })
  async deactivateRole(
    @CurrentCompany() company: CompanyContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
  ) {
    return { data: await this.parties.deactivateRole(company, id, roleId) };
  }
}
