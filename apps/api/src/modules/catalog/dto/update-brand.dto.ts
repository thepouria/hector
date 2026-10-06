import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { BRAND_CODE_MAX_LENGTH, BRAND_NAME_MAX_LENGTH } from '../catalog.constants';

export class UpdateBrandDto {
  @ApiPropertyOptional({ maxLength: BRAND_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(BRAND_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: BRAND_CODE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(BRAND_CODE_MAX_LENGTH)
  code?: string | null;
}
