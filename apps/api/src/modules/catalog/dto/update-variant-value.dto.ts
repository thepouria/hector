import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { VARIANT_VALUE_MAX_LENGTH } from '../catalog.constants';

export class UpdateVariantValueDto {
  @ApiPropertyOptional({ maxLength: VARIANT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(VARIANT_VALUE_MAX_LENGTH)
  value?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;
}
