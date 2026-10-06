import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PutawayStatus } from '@hector/database';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PUTAWAY_SEARCH_MAX_LENGTH } from '../putaway.constants';

export class CreatePutawayDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  goodsReceiptId!: string;
}

export class ListPutawaysQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PutawayStatus })
  @IsOptional()
  @IsEnum(PutawayStatus)
  status?: PutawayStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;

  @ApiPropertyOptional({ maxLength: PUTAWAY_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PUTAWAY_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}

export class ListPendingPutawayQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  goodsReceiptId?: string;

  @ApiPropertyOptional({ maxLength: PUTAWAY_SEARCH_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PUTAWAY_SEARCH_MAX_LENGTH)
  @MinLength(1)
  q?: string;
}

export class UpsertPutawayItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  receiptBatchAllocationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseLocationId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class UpdatePutawayItemDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseLocationId?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class ResolvePutawayLocationDto {
  @ApiProperty({
    description: 'Raw location barcode. Preserves leading zeros. Not a product barcode.',
    example: 'LOC-A-03',
  })
  @IsString()
  @MaxLength(64)
  barcode!: string;
}

export class ScanApplyPutawayDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  receiptBatchAllocationId!: string;

  @ApiProperty({
    description: 'Location barcode to resolve within putaway warehouse context.',
    example: 'LOC-A-03',
  })
  @IsString()
  @MaxLength(64)
  locationBarcode!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional client UUID; same requestId retries apply once.',
  })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class SearchPutawayLocationsQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Type(() => String)
  q?: string;
}
