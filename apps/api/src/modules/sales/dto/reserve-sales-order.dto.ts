import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ReserveSalesOrderDto {
  @ApiPropertyOptional({
    description: 'Warehouse to reserve against. Defaults to first active non-system warehouse.',
  })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
