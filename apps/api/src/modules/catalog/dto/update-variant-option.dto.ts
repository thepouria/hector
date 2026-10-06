import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { VARIANT_OPTION_NAME_MAX_LENGTH } from '../catalog.constants';

export class UpdateVariantOptionDto {
  @ApiPropertyOptional({ maxLength: VARIANT_OPTION_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(VARIANT_OPTION_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;
}
