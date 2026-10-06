import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { BarcodeType } from '@hector/database';

export class UpdateBarcodeDto {
  @ApiPropertyOptional({ enum: BarcodeType })
  @IsOptional()
  @IsEnum(BarcodeType)
  type?: BarcodeType;

  @ApiPropertyOptional({
    description: 'Setting true atomically demotes any other primary barcode on the same SKU.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
