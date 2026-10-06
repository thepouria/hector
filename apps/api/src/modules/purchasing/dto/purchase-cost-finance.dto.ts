import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PurchaseCostAllocationMethod,
  PurchaseCostAllocationTargetType,
  PurchaseCostTreatment,
} from '@hector/database';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SetPurchaseCostTreatmentBodyDto {
  @ApiProperty({ enum: PurchaseCostTreatment })
  @IsEnum(PurchaseCostTreatment)
  treatment!: PurchaseCostTreatment;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  expenseCategoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export class ManualAllocationLineDto {
  @ApiProperty({ enum: PurchaseCostAllocationTargetType })
  @IsEnum(PurchaseCostAllocationTargetType)
  targetType!: PurchaseCostAllocationTargetType;

  @ApiProperty()
  @IsUUID()
  targetId!: string;

  @ApiProperty({ example: '4000000' })
  @IsString()
  amount!: string;
}

export class PreviewPurchaseCostAllocationBodyDto {
  @ApiProperty({ enum: PurchaseCostAllocationMethod })
  @IsEnum(PurchaseCostAllocationMethod)
  method!: PurchaseCostAllocationMethod;

  @ApiPropertyOptional({ type: [ManualAllocationLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualAllocationLineDto)
  lines?: ManualAllocationLineDto[];
}

export class AllocatePurchaseCostBodyDto extends PreviewPurchaseCostAllocationBodyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
