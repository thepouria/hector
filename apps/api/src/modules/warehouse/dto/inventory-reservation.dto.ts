import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InventoryReservationSourceType,
  InventoryReservationStatus,
} from '@hector/database';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AVAILABILITY_BULK_MAX } from '../inventory-reservations.constants';

export class CreateInventoryReservationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ enum: InventoryReservationSourceType })
  @IsEnum(InventoryReservationSourceType)
  sourceType!: InventoryReservationSourceType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceLineId?: string;

  @ApiProperty({ format: 'uuid', description: 'Idempotency key' })
  @IsUUID()
  requestId!: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class ReleaseInventoryReservationDto {
  @ApiPropertyOptional({
    minimum: 1,
    description: 'Partial release quantity; omit to release all remaining',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class AdjustInventoryReservationDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class ListInventoryReservationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ enum: InventoryReservationStatus })
  @IsOptional()
  @IsEnum(InventoryReservationStatus)
  status?: InventoryReservationStatus;

  @ApiPropertyOptional({ enum: InventoryReservationSourceType })
  @IsOptional()
  @IsEnum(InventoryReservationSourceType)
  sourceType?: InventoryReservationSourceType;
}

export class AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;
}

export class BulkAvailabilityItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  warehouseId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;
}

export class BulkAvailabilityDto {
  @ApiProperty({ type: [BulkAvailabilityItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(AVAILABILITY_BULK_MAX)
  @ValidateNested({ each: true })
  @Type(() => BulkAvailabilityItemDto)
  items!: BulkAvailabilityItemDto[];
}
