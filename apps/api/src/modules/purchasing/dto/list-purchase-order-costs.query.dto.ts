import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CurrencyCode,
  PurchaseCostStatus,
  PurchaseCostType,
} from '@hector/database';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export class ListPurchaseOrderCostsQueryDto {
  @ApiPropertyOptional({ enum: PurchaseCostType })
  @IsOptional()
  @IsEnum(PurchaseCostType)
  costType?: PurchaseCostType;

  @ApiPropertyOptional({ enum: PurchaseCostStatus })
  @IsOptional()
  @IsEnum(PurchaseCostStatus)
  status?: PurchaseCostStatus;

  @ApiPropertyOptional({ enum: CurrencyCode })
  @IsOptional()
  @IsEnum(CurrencyCode)
  currency?: CurrencyCode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  costDateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  costDateTo?: string;
}
