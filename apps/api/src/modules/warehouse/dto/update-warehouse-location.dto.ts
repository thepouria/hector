import { ApiPropertyOptional } from '@nestjs/swagger';
import { WarehouseLocationType } from '@hector/database';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import {
  LOCATION_CODE_MAX_LENGTH,
  LOCATION_NAME_MAX_LENGTH,
  LOCATION_NOTES_MAX_LENGTH,
} from '../warehouse-location.constants';

export class UpdateWarehouseLocationDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Move under another parent (same warehouse) or null for root.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;

  @ApiPropertyOptional({ enum: WarehouseLocationType })
  @IsOptional()
  @IsEnum(WarehouseLocationType)
  type?: WarehouseLocationType;

  @ApiPropertyOptional({ maxLength: LOCATION_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOCATION_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: LOCATION_NAME_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(LOCATION_NAME_MAX_LENGTH)
  name?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: LOCATION_NOTES_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(LOCATION_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;
}
