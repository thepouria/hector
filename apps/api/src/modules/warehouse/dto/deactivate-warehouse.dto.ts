import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class DeactivateWarehouseDto {
  @ApiPropertyOptional({
    description:
      'Required when deactivating the current default and another ACTIVE warehouse exists.',
  })
  @IsOptional()
  @IsUUID()
  replacementWarehouseId?: string;
}
