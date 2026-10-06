import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  BATCH_NOTES_MAX_LENGTH,
  BATCH_SEARCH_MAX_LENGTH,
  BATCH_SUPPLIER_NUMBER_MAX_LENGTH,
} from '../batch.constants';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CreateBatchDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiPropertyOptional({
    description: 'Supplier/manufacturer lot text. Preserved as string.',
    maxLength: BATCH_SUPPLIER_NUMBER_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BATCH_SUPPLIER_NUMBER_MAX_LENGTH)
  supplierBatchNumber?: string | null;

  @ApiPropertyOptional({ format: 'date', example: '2026-01-15' })
  @IsOptional()
  @IsDateString()
  manufacturedAt?: string | null;

  @ApiPropertyOptional({ format: 'date', example: '2029-10-01' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({ maxLength: BATCH_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(BATCH_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class UpdateBatchDto {
  @ApiPropertyOptional({ maxLength: BATCH_SUPPLIER_NUMBER_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(BATCH_SUPPLIER_NUMBER_MAX_LENGTH)
  supplierBatchNumber?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  manufacturedAt?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({ maxLength: BATCH_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(BATCH_NOTES_MAX_LENGTH)
  notes?: string | null;
}

export class ListBatchesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ maxLength: BATCH_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(BATCH_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;

  @ApiPropertyOptional({ format: 'date', description: 'expiresAt <= this date' })
  @IsOptional()
  @IsDateString()
  expiresBefore?: string;

  @ApiPropertyOptional({ format: 'date', description: 'expiresAt >= this date' })
  @IsOptional()
  @IsDateString()
  expiresAfter?: string;

  @ApiPropertyOptional({ description: 'When true, only batches with null expiresAt' })
  @IsOptional()
  @Type(() => String)
  @IsString()
  noExpiry?: string;
}

export class UpsertGoodsReceiptItemBatchDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing batch id. Prefer this when selecting an existing batch.',
  })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({
    description:
      'When batchId is omitted, find-or-create by supplier batch for the receipt item SKU.',
    maxLength: BATCH_SUPPLIER_NUMBER_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(BATCH_SUPPLIER_NUMBER_MAX_LENGTH)
  supplierBatchNumber?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  manufacturedAt?: string | null;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class UpdateGoodsReceiptItemBatchDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}
