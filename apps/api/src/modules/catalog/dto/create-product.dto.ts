import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  PRODUCT_CODE_MAX_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
} from '../catalog.constants';

export class CreateProductDto {
  @ApiProperty({ example: 'رژ لب جامد فانوما', maxLength: PRODUCT_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_NAME_MAX_LENGTH)
  name!: string;

  @ApiPropertyOptional({ example: 'FAN-SL', maxLength: PRODUCT_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: PRODUCT_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  brandId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
