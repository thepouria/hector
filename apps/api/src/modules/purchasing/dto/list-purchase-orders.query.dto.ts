import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
  PurchaseOrderStatus,
} from '@hector/database';
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  PURCHASE_DUE_STATUSES,
  PURCHASE_ORDER_SEARCH_MAX_LENGTH,
  PURCHASE_ORDER_SORT_FIELDS,
  type PurchaseDueStatus,
  type PurchaseOrderSortField,
} from '../purchasing.constants';
import { IsDateRangeStart } from './date-range.constraint';

export class ListPurchaseOrdersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Matches PO number, notes, supplier name/code, SKU code/name, product name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PURCHASE_ORDER_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: PurchaseOrderStatus })
  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @ApiPropertyOptional({ enum: PurchaseCommercialType })
  @IsOptional()
  @IsEnum(PurchaseCommercialType)
  purchaseType?: PurchaseCommercialType;

  @ApiPropertyOptional({ enum: PaymentTermType })
  @IsOptional()
  @IsEnum(PaymentTermType)
  paymentTermType?: PaymentTermType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ description: 'ISO datetime — orderDate >= from' })
  @IsOptional()
  @IsDateString()
  @IsDateRangeStart('orderTo')
  orderFrom?: string;

  @ApiPropertyOptional({ description: 'ISO datetime — orderDate <= to' })
  @IsOptional()
  @IsDateString()
  orderTo?: string;

  @ApiPropertyOptional({ description: 'ISO datetime — createdAt >= from' })
  @IsOptional()
  @IsDateString()
  @IsDateRangeStart('createdTo')
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'ISO datetime — createdAt <= to' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ description: 'ISO date/datetime — dueDate >= from (contractual)' })
  @IsOptional()
  @IsDateString()
  @IsDateRangeStart('dueTo')
  dueFrom?: string;

  @ApiPropertyOptional({ description: 'ISO date/datetime — dueDate <= to (contractual)' })
  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @ApiPropertyOptional({
    enum: PURCHASE_DUE_STATUSES,
    description:
      'Derived contractual due status (not payment/unpaid state). OVERDUE / dueDatePassed semantics only.',
  })
  @IsOptional()
  @IsIn([...PURCHASE_DUE_STATUSES])
  dueStatus?: PurchaseDueStatus;

  @ApiPropertyOptional({ enum: PURCHASE_ORDER_SORT_FIELDS, default: 'orderDate' })
  @IsOptional()
  @IsIn([...PURCHASE_ORDER_SORT_FIELDS])
  sortBy: PurchaseOrderSortField = 'orderDate';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
