import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { VARIANT_OPTION_NAME_MAX_LENGTH } from '../catalog.constants';

export class CreateVariantOptionDto {
  @ApiProperty({ example: 'رنگ', maxLength: VARIANT_OPTION_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(VARIANT_OPTION_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ minimum: 0, description: 'Display order; defaults to last.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;
}
