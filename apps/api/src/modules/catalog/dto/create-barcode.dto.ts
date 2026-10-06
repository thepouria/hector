import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { BarcodeType } from '@hector/database';
import { BARCODE_VALUE_MAX_LENGTH } from '../catalog.constants';

/** @deprecated Prefer POST /catalog/skus/:skuId/barcodes — kept for older clients/tests. */
export class CreateBarcodeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ example: '4006381333931', maxLength: BARCODE_VALUE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BARCODE_VALUE_MAX_LENGTH)
  value!: string;

  @ApiPropertyOptional({ enum: BarcodeType, default: BarcodeType.OTHER })
  @IsOptional()
  @IsEnum(BarcodeType)
  type?: BarcodeType;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
