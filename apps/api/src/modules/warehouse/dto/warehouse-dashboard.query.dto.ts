import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class WarehouseDashboardQueryDto {
  @ApiPropertyOptional({ description: 'Optional warehouse filter for snapshot + operations' })
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;
}
