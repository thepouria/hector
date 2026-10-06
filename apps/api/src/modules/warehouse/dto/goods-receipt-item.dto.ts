import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH } from '../goods-receipt.constants';

export class AddGoodsReceiptItemDto {
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

export class UpdateGoodsReceiptItemDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ maxLength: GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(GOODS_RECEIPT_ITEM_NOTES_MAX_LENGTH)
  notes?: string | null;
}
