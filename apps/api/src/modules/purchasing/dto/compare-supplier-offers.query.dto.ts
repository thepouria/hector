import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

/** Latest non-archived offer per supplier for a SKU (comparison view). */
export class CompareSupplierOffersQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skuId!: string;

  @ApiPropertyOptional({
    description: 'When true, exclude offers whose validUntil is in the past.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  excludeExpired?: boolean;
}
