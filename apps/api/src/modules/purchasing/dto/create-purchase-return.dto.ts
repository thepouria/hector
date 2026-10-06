import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseReturnReason, PurchaseReturnResolution } from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PURCHASE_ORDER_MAX_QUANTITY,
  PURCHASE_RETURN_MAX_ITEMS,
  PURCHASE_RETURN_NOTES_MAX_LENGTH,
} from '../purchasing.constants';

export class CreatePurchaseReturnItemDto {
  @ApiPropertyOptional({ description: 'Preferred link to original PO line' })
  @IsOptional()
  @IsUUID()
  purchaseOrderItemId?: string;

  @ApiPropertyOptional({
    description: 'Required when purchaseOrderItemId omitted; validated against PO item when present',
  })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(PURCHASE_ORDER_MAX_QUANTITY)
  quantity!: number;

  @ApiPropertyOptional({ enum: PurchaseReturnReason })
  @IsOptional()
  @IsEnum(PurchaseReturnReason)
  reason?: PurchaseReturnReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_RETURN_NOTES_MAX_LENGTH)
  notes?: string;
}

export class CreatePurchaseReturnDto {
  @ApiProperty({ description: 'Source purchase order (required for normal supplier returns)' })
  @IsUUID()
  purchaseOrderId!: string;

  @ApiProperty({ enum: PurchaseReturnReason })
  @IsEnum(PurchaseReturnReason)
  reason!: PurchaseReturnReason;

  @ApiPropertyOptional({ enum: PurchaseReturnResolution, default: PurchaseReturnResolution.UNKNOWN })
  @IsOptional()
  @IsEnum(PurchaseReturnResolution)
  expectedResolution?: PurchaseReturnResolution;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_RETURN_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiProperty({ type: [CreatePurchaseReturnItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_RETURN_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReturnItemDto)
  items!: CreatePurchaseReturnItemDto[];
}

export class UpdatePurchaseReturnDto {
  @ApiPropertyOptional({ enum: PurchaseReturnReason })
  @IsOptional()
  @IsEnum(PurchaseReturnReason)
  reason?: PurchaseReturnReason;

  @ApiPropertyOptional({ enum: PurchaseReturnResolution })
  @IsOptional()
  @IsEnum(PurchaseReturnResolution)
  expectedResolution?: PurchaseReturnResolution;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_RETURN_NOTES_MAX_LENGTH)
  notes?: string | null;

  @ApiPropertyOptional({ description: 'Return optimistic concurrency version' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class CancelPurchaseReturnDto {
  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}
