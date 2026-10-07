import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesOrderCancelReason } from '@hector/database';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SALES_ORDER_NOTES_MAX_LENGTH } from '../sales.constants';

export class CancelSalesOrderDto {
  @ApiProperty({ enum: SalesOrderCancelReason })
  @IsEnum(SalesOrderCancelReason)
  reason!: SalesOrderCancelReason;

  @ApiPropertyOptional({ maxLength: SALES_ORDER_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_ORDER_NOTES_MAX_LENGTH)
  notes?: string;
}
