import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PURCHASE_COST_VOID_REASON_MAX_LENGTH } from '../purchasing.constants';

export class VoidPurchaseOrderCostDto {
  @ApiProperty({
    description: 'Required reason for voiding a confirmed/historical cost.',
    minLength: 1,
    maxLength: PURCHASE_COST_VOID_REASON_MAX_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(PURCHASE_COST_VOID_REASON_MAX_LENGTH)
  reason!: string;
}
