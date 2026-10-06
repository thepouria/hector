import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import {
  PURCHASE_ORDER_CANCELLATION_REASON_MAX_LENGTH,
  PURCHASE_ORDER_SUPPLIER_ORDER_REFERENCE_MAX_LENGTH,
} from '../purchasing.constants';

export class PurchaseOrderTransitionDto {
  @ApiPropertyOptional({
    minimum: 1,
    description: 'Optimistic concurrency guard; 409 when the PO version differs.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedVersion?: number;
}

/**
 * APPROVED → ORDERED (Phase 2.9).
 * `orderDate` is the business calendar date for credit terms; `orderedAt` remains server-owned.
 */
export class OrderPurchaseOrderDto extends PurchaseOrderTransitionDto {
  @ApiPropertyOptional({
    description:
      'Optional business order date (ISO). Updates orderDate used for NET_DAYS/ORDER_DATE basis before freeze.',
  })
  @IsOptional()
  @IsDateString()
  orderDate?: string;

  @ApiPropertyOptional({
    maxLength: PURCHASE_ORDER_SUPPLIER_ORDER_REFERENCE_MAX_LENGTH,
    description: 'Optional supplier invoice / order / agreement reference.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_ORDER_SUPPLIER_ORDER_REFERENCE_MAX_LENGTH)
  supplierOrderReference?: string;
}

export class CancelPurchaseOrderDto extends PurchaseOrderTransitionDto {
  @ApiProperty({
    description:
      'Required when cancelling APPROVED or ORDERED. Optional for DRAFT. Preserved for history.',
    maxLength: PURCHASE_ORDER_CANCELLATION_REASON_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PURCHASE_ORDER_CANCELLATION_REASON_MAX_LENGTH)
  reason?: string;
}
