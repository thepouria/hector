import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StockClassification } from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SALES_RETURN_NOTES_MAX_LENGTH } from '../sales.constants';

export class ReceiveSalesReturnItemDto {
  @ApiProperty()
  @IsUUID()
  salesReturnItemId!: string;

  @ApiProperty()
  @IsUUID()
  locationId!: string;

  @ApiProperty()
  @IsUUID()
  batchId!: string;

  @ApiPropertyOptional({
    enum: StockClassification,
    description: 'Defaults from return condition when omitted.',
  })
  @IsOptional()
  @IsEnum(StockClassification)
  classification?: StockClassification;
}

export class ReceiveSalesReturnDto {
  @ApiProperty()
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ type: [ReceiveSalesReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveSalesReturnItemDto)
  items!: ReceiveSalesReturnItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(SALES_RETURN_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
