import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BRAND_CODE_MAX_LENGTH, BRAND_NAME_MAX_LENGTH } from '../catalog.constants';

export class CreateBrandDto {
  @ApiProperty({ example: 'Fanoma', maxLength: BRAND_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRAND_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ example: 'FAN', maxLength: BRAND_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(BRAND_CODE_MAX_LENGTH)
  code?: string;
}
