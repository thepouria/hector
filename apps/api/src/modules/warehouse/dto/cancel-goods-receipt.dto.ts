import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { GOODS_RECEIPT_CANCELLATION_REASON_MAX_LENGTH } from '../goods-receipt.constants';

export class CancelGoodsReceiptDto {
  @ApiPropertyOptional({ maxLength: GOODS_RECEIPT_CANCELLATION_REASON_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(GOODS_RECEIPT_CANCELLATION_REASON_MAX_LENGTH)
  reason?: string;
}
