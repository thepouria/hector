import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ATTRIBUTE_OPTION_VALUE_MAX_LENGTH } from '../catalog.constants';

export class CreateAttributeOptionDto {
  @ApiProperty({ maxLength: ATTRIBUTE_OPTION_VALUE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ATTRIBUTE_OPTION_VALUE_MAX_LENGTH)
  value!: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;
}
