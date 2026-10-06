import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import {
  WAREHOUSE_ADDRESS_MAX_LENGTH,
  WAREHOUSE_CODE_MAX_LENGTH,
  WAREHOUSE_NAME_MAX_LENGTH,
  WAREHOUSE_NOTES_MAX_LENGTH,
} from '../warehouse.constants';

export class UpdateWarehouseDto {
  @ApiPropertyOptional({ maxLength: WAREHOUSE_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(WAREHOUSE_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: WAREHOUSE_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(WAREHOUSE_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: WAREHOUSE_ADDRESS_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(WAREHOUSE_ADDRESS_MAX_LENGTH)
  address?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: WAREHOUSE_NOTES_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(WAREHOUSE_NOTES_MAX_LENGTH)
  notes?: string | null;
}
