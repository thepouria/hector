import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WarehouseLocationType } from '@hector/database';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import {
  LOCATION_CODE_MAX_LENGTH,
  LOCATION_NAME_MAX_LENGTH,
  LOCATION_NOTES_MAX_LENGTH,
} from '../warehouse-location.constants';

export class CreateWarehouseLocationDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'Parent location in the same warehouse. Null = root under warehouse.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({ enum: WarehouseLocationType, example: WarehouseLocationType.SHELF })
  @IsEnum(WarehouseLocationType)
  type!: WarehouseLocationType;

  @ApiProperty({ example: 'S01', maxLength: LOCATION_CODE_MAX_LENGTH })
  @IsString()
  @MaxLength(LOCATION_CODE_MAX_LENGTH)
  code!: string;

  @ApiPropertyOptional({ maxLength: LOCATION_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOCATION_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: LOCATION_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(LOCATION_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ description: 'Sibling display order', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;
}
