import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { BarcodeType } from '@hector/database';
import { BARCODE_VALUE_MAX_LENGTH } from '../catalog.constants';

export class CreateSkuBarcodeDto {
  @ApiProperty({ example: '4006381333931', maxLength: BARCODE_VALUE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BARCODE_VALUE_MAX_LENGTH)
  value!: string;

  @ApiPropertyOptional({ enum: BarcodeType, default: BarcodeType.OTHER })
  @IsOptional()
  @IsEnum(BarcodeType)
  type?: BarcodeType;

  @ApiPropertyOptional({
    description:
      'When omitted, the first active barcode on a SKU becomes primary automatically.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
