import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CATEGORY_CODE_MAX_LENGTH, CATEGORY_NAME_MAX_LENGTH } from '../catalog.constants';

export class CreateCategoryDto {
  @ApiProperty({ example: 'رژ لب جامد', maxLength: CATEGORY_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(CATEGORY_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ example: 'LIPSTICK', maxLength: CATEGORY_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CATEGORY_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;
}
