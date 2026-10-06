import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  PaymentTermType,
  PurchaseCommercialType,
} from '@hector/database';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  SUPPLIER_OFFER_SEARCH_MAX_LENGTH,
  SUPPLIER_OFFER_SORT_FIELDS,
  type SupplierOfferSortField,
} from '../purchasing.constants';
import { IsDateRangeStart } from './date-range.constraint';

export class ListSupplierOffersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_OFFER_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ enum: PurchaseCommercialType })
  @IsOptional()
  @IsEnum(PurchaseCommercialType)
  purchaseType?: PurchaseCommercialType;

  @ApiPropertyOptional({ enum: PaymentTermType })
  @IsOptional()
  @IsEnum(PaymentTermType)
  paymentTermType?: PaymentTermType;

  @ApiPropertyOptional({ description: 'ISO datetime — quotedAt >= from' })
  @IsOptional()
  @IsDateString()
  @IsDateRangeStart('quotedTo')
  quotedFrom?: string;

  @ApiPropertyOptional({ description: 'ISO datetime — quotedAt <= to' })
  @IsOptional()
  @IsDateString()
  quotedTo?: string;

  @ApiPropertyOptional({
    description:
      'ISO datetime — offers that were commercially valid at this instant (not archived; quotedAt <= validAt; validUntil null or >= validAt).',
  })
  @IsOptional()
  @IsDateString()
  validAt?: string;

  @ApiPropertyOptional({
    enum: ['CURRENT', 'EXPIRED', 'NO_EXPIRY', 'ARCHIVED', 'ACTIVE'],
    description:
      'CURRENT = not archived and (no expiry or validUntil >= now). EXPIRED = validUntil < now. ACTIVE = not archived. ARCHIVED = archived only.',
  })
  @IsOptional()
  @IsIn(['CURRENT', 'EXPIRED', 'NO_EXPIRY', 'ARCHIVED', 'ACTIVE'])
  validity?: 'CURRENT' | 'EXPIRED' | 'NO_EXPIRY' | 'ARCHIVED' | 'ACTIVE';

  @ApiPropertyOptional({ enum: SUPPLIER_OFFER_SORT_FIELDS, default: 'quotedAt' })
  @IsOptional()
  @IsIn([...SUPPLIER_OFFER_SORT_FIELDS])
  sortBy: SupplierOfferSortField = 'quotedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}
