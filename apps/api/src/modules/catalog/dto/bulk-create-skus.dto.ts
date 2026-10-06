import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { BULK_SKU_MAX } from '../catalog.constants';
import { CreateSkuDto } from './create-sku.dto';

export class BulkCreateSkusDto {
  @ApiProperty({
    type: [CreateSkuDto],
    description: `All-or-nothing batch (max ${BULK_SKU_MAX}; enforced by the service).`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSkuDto)
  items!: CreateSkuDto[];
}
