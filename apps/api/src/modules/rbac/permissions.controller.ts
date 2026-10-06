import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hector/database';
import {
  ApiCompanyHeader,
  RequireCompany,
} from '../companies/decorators/require-company.decorator';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import { PermissionsService } from './permissions.service';

@ApiTags('permissions')
@ApiBearerAuth()
@ApiSecurity('company-id')
@ApiCompanyHeader()
@RequireCompany()
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PERMISSION_READ)
  @ApiOperation({
    summary: 'List Hector permission catalog',
    description: `Requires \`${PERMISSIONS.PERMISSION_READ}\`.`,
  })
  async list() {
    const data = await this.permissionsService.list();
    return { data };
  }
}
