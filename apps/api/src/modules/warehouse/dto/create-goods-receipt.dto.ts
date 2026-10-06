import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH,
  GOODS_RECEIPT_MAX_ITEMS,
  GOODS_RECEIPT_NOTES_MAX_LENGTH,
} from '../goods-receipt.constants';

export class CreateGoodsReceiptItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  purchaseOrderItemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ maxLength: GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CreateGoodsReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  purchaseOrderId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiPropertyOptional({
    description: 'Physical receipt timestamp (ISO). Defaults unset until post if omitted.',
  })
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @ApiPropertyOptional({ maxLength: GOODS_RECEIPT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(GOODS_RECEIPT_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ type: [CreateGoodsReceiptItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GOODS_RECEIPT_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiptItemDto)
  items?: CreateGoodsReceiptItemDto[];
}
