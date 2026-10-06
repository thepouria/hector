import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { GOODS_RECEIPT_NOTES_MAX_LENGTH } from '../goods-receipt.constants';

export class UpdateGoodsReceiptDto {
  @ApiPropertyOptional({ description: 'Physical receipt timestamp (ISO).' })
  @IsOptional()
  @IsDateString()
  receivedAt?: string | null;

  @ApiPropertyOptional({ maxLength: GOODS_RECEIPT_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(GOODS_RECEIPT_NOTES_MAX_LENGTH)
  notes?: string | null;
}
