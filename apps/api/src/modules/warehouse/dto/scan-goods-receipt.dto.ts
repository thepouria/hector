import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { BATCH_SUPPLIER_NUMBER_MAX_LENGTH } from '../batch.constants';

/** Max raw barcode length accepted by scanner endpoints (Catalog enforces tighter rules). */
const SCAN_BARCODE_MAX_LENGTH = 128;

export class ScanResolveGoodsReceiptDto {
  @ApiProperty({
    description: 'Raw barcode string from keyboard wedge / manual entry. Preserves leading zeros.',
    example: '4059729196967',
  })
  @IsString()
  @MaxLength(SCAN_BARCODE_MAX_LENGTH)
  barcode!: string;
}

export class ScanApplyGoodsReceiptDto {
  @ApiProperty({
    description: 'Raw barcode string. Server resolves barcode → SKU → PO item (client IDs ignored).',
    example: '4059729196967',
  })
  @IsString()
  @MaxLength(SCAN_BARCODE_MAX_LENGTH)
  barcode!: string;

  @ApiProperty({
    description: 'Quantity to add to the DRAFT GRN item (integer > 0). Unit mode sends 1.',
    minimum: 1,
    example: 1,
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Optional client UUID per submission. Same requestId retries apply once; new requestId = new scan.',
  })
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional existing batch for this SKU. Mutually preferred over supplierBatchNumber.',
  })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({
    description:
      'Optional supplier/manufacturer lot text. Find-or-create Batch for the resolved SKU when batchId omitted.',
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

  @ApiPropertyOptional({ format: 'date', description: 'Optional expiry. Not required to receive.' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
