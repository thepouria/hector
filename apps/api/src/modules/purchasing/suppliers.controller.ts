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
import { CreateSupplierContactDto } from './dto/create-supplier-contact.dto';
import { CreateSupplierNoteDto } from './dto/create-supplier-note.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSupplierNotesQueryDto } from './dto/list-supplier-notes.query.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers.query.dto';
import { UpdateSupplierContactDto } from './dto/update-supplier-contact.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierContactsService } from './supplier-contacts.service';
import { SupplierNotesService } from './supplier-notes.service';
import { SuppliersService } from './suppliers.service';

@ApiTags('purchasing-suppliers')
@ApiBearerAuth()
@RequireCompany()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@Controller('purchasing/suppliers')
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly contactsService: SupplierContactsService,
    private readonly notesService: SupplierNotesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({
    summary: 'List suppliers',
    description: 'Default list excludes ARCHIVED. Pass status=ARCHIVED to include archived only.',
  })
  async list(@CurrentCompany() company: CompanyContext, @Query() query: ListSuppliersQueryDto) {
    return this.suppliersService.list(company, query);
  }

  @Get(':supplierId')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'Get supplier detail with active contacts' })
  async get(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ) {
    const data = await this.suppliersService.get(company, supplierId);
    return { data };
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PURCHASING_CREATE)
  @ApiOperation({ summary: 'Create a supplier' })
  async create(@CurrentCompany() company: CompanyContext, @Body() body: CreateSupplierDto) {
    const data = await this.suppliersService.create(company, body);
    return { data };
  }

  @Patch(':supplierId')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Update supplier metadata (not status)' })
  async update(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() body: UpdateSupplierDto,
  ) {
    const data = await this.suppliersService.update(company, supplierId, body);
    return { data };
  }

  @Post(':supplierId/activate')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Activate supplier (INACTIVE/ARCHIVED → ACTIVE)' })
  async activate(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ) {
    const data = await this.suppliersService.activate(company, supplierId);
    return { data };
  }

  @Post(':supplierId/deactivate')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Deactivate supplier (ACTIVE → INACTIVE)' })
  async deactivate(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ) {
    const data = await this.suppliersService.deactivate(company, supplierId);
    return { data };
  }

  @Post(':supplierId/archive')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Archive supplier (non-destructive)' })
  async archive(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ) {
    const data = await this.suppliersService.archive(company, supplierId);
    return { data };
  }

  @Get(':supplierId/contacts')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'List active contacts for a supplier' })
  async listContacts(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
  ) {
    const data = await this.contactsService.list(company, supplierId);
    return { data };
  }

  @Post(':supplierId/contacts')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Add a supplier contact' })
  async createContact(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() body: CreateSupplierContactDto,
  ) {
    const data = await this.contactsService.create(company, supplierId, body);
    return { data };
  }

  @Patch(':supplierId/contacts/:contactId')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Update a supplier contact' })
  async updateContact(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
    @Body() body: UpdateSupplierContactDto,
  ) {
    const data = await this.contactsService.update(company, supplierId, contactId, body);
    return { data };
  }

  @Post(':supplierId/contacts/:contactId/set-primary')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Set contact as primary (atomic)' })
  async setPrimaryContact(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    const data = await this.contactsService.setPrimary(company, supplierId, contactId);
    return { data };
  }

  @Post(':supplierId/contacts/:contactId/archive')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Archive a supplier contact' })
  async archiveContact(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Param('contactId', ParseUUIDPipe) contactId: string,
  ) {
    const data = await this.contactsService.archive(company, supplierId, contactId);
    return { data };
  }

  @Get(':supplierId/notes')
  @RequirePermissions(PERMISSIONS.PURCHASING_READ)
  @ApiOperation({ summary: 'List supplier notes (timeline, paginated)' })
  async listNotes(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Query() query: ListSupplierNotesQueryDto,
  ) {
    return this.notesService.list(company, supplierId, query);
  }

  @Post(':supplierId/notes')
  @RequirePermissions(PERMISSIONS.PURCHASING_MANAGE)
  @ApiOperation({ summary: 'Add a supplier note' })
  async createNote(
    @CurrentCompany() company: CompanyContext,
    @Param('supplierId', ParseUUIDPipe) supplierId: string,
    @Body() body: CreateSupplierNoteDto,
  ) {
    const data = await this.notesService.create(company, supplierId, body);
    return { data };
  }
}
