import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH,
  PURCHASE_ORDER_MAX_QUANTITY,
} from '../purchasing.constants';

/** A purchase-order line. Totals are computed server-side; do not send lineSubtotal. */
export class PurchaseOrderItemInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ minimum: 1, maximum: PURCHASE_ORDER_MAX_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_QUANTITY)
  quantity!: number;

  @ApiProperty({
    example: '5850000',
    description: 'Decimal string. IRR = whole rials. USD up to 6 decimals.',
  })
  @IsString()
  @IsNotEmpty()
  unitPrice!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional supplier offer reference (same supplier + SKU, matching PO currency). The PO price may differ.',
  })
  @IsOptional()
  @IsUUID()
  supplierOfferId?: string;

  @ApiPropertyOptional({ maxLength: PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH)
  notes?: string;
}

export class AddPurchaseOrderItemDto extends PurchaseOrderItemInputDto {}

export class UpdatePurchaseOrderItemDto {
  @ApiPropertyOptional({ minimum: 1, maximum: PURCHASE_ORDER_MAX_QUANTITY })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_QUANTITY)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Decimal string' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  unitPrice?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'null clears the reference' })
  @IsOptional()
  @IsUUID()
  supplierOfferId?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_ORDER_ITEM_NOTES_MAX_LENGTH)
  notes?: string | null;
}
