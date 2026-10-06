import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  SupplierPayableStatus,
} from '@hector/database';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  SUPPLIER_PAYABLE_NOTES_MAX_LENGTH,
  SUPPLIER_PAYABLE_REFERENCE_MAX_LENGTH,
  SUPPLIER_PAYABLE_SEARCH_MAX_LENGTH,
} from '../finance-supplier-payables.constants';

export class ListSupplierPayablesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;

  @ApiPropertyOptional({ enum: SupplierPayableStatus })
  @IsOptional()
  @IsEnum(SupplierPayableStatus)
  status?: SupplierPayableStatus;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional({ maxLength: SUPPLIER_PAYABLE_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_PAYABLE_SEARCH_MAX_LENGTH)
  q?: string;
}

export class CreateOpeningSupplierPayableDto {
  @ApiProperty()
  @IsUUID()
  supplierId!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiProperty({ example: '15000000' })
  @IsString()
  amount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_PAYABLE_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_PAYABLE_NOTES_MAX_LENGTH)
  notes?: string;

  @ApiPropertyOptional({ maxLength: SUPPLIER_PAYABLE_REFERENCE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_PAYABLE_REFERENCE_MAX_LENGTH)
  reference?: string;

  @ApiPropertyOptional({ description: 'Idempotency key for opening payable.' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class AllocateSupplierPaymentDto {
  @ApiProperty({ example: '1000000' })
  @IsString()
  amount!: string;

  @ApiProperty({ enum: CurrencyCode })
  @IsEnum(CurrencyCode)
  currency!: CurrencyCode;

  @ApiPropertyOptional({ description: 'Future payment document type (Phase 4.6).' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentSourceType?: string;

  @ApiPropertyOptional({ description: 'Future payment document id (Phase 4.6).' })
  @IsOptional()
  @IsUUID()
  paymentSourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
