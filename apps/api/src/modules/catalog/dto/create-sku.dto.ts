import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SKU_CODE_MAX_LENGTH, SKU_NAME_MAX_LENGTH } from '../catalog.constants';

export class CreateSkuDto {
  @ApiProperty({ example: 'FAN-SL-01', maxLength: SKU_CODE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(SKU_CODE_MAX_LENGTH)
  code!: string;

  @ApiPropertyOptional({ example: 'رنگ 01', maxLength: SKU_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SKU_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Exactly one value per variant option of the product. Omit/empty for products without options.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  optionValueIds?: string[];
}
