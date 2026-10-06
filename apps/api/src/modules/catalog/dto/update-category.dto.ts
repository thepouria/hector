import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CATEGORY_CODE_MAX_LENGTH, CATEGORY_NAME_MAX_LENGTH } from '../catalog.constants';

export class UpdateCategoryDto {
  @ApiPropertyOptional({ maxLength: CATEGORY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(CATEGORY_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: CATEGORY_CODE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(CATEGORY_CODE_MAX_LENGTH)
  code?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;
}
