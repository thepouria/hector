import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  WAREHOUSE_ADDRESS_MAX_LENGTH,
  WAREHOUSE_CODE_MAX_LENGTH,
  WAREHOUSE_NAME_MAX_LENGTH,
  WAREHOUSE_NOTES_MAX_LENGTH,
} from '../warehouse.constants';

export class CreateWarehouseDto {
  @ApiProperty({ example: 'MAIN', maxLength: WAREHOUSE_CODE_MAX_LENGTH })
  @IsString()
  @MaxLength(WAREHOUSE_CODE_MAX_LENGTH)
  code!: string;

  @ApiProperty({ example: 'انبار اصلی', maxLength: WAREHOUSE_NAME_MAX_LENGTH })
  @IsString()
  @MaxLength(WAREHOUSE_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ maxLength: WAREHOUSE_ADDRESS_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(WAREHOUSE_ADDRESS_MAX_LENGTH)
  address?: string;

  @ApiPropertyOptional({ maxLength: WAREHOUSE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(WAREHOUSE_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    description:
      'When true, this warehouse becomes the company default (transactionally). First warehouse is always default.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
