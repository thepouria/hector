import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettlementFinanceTxnType } from '@hector/database';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { SettlementFxDto } from './domain-settle.dto';

export class CreateSettlementAllocationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  settlementItemId!: string;

  @ApiProperty({
    enum: SettlementFinanceTxnType,
    description: 'Phase 6.1/6.2: PAYMENT only',
  })
  @IsEnum(SettlementFinanceTxnType)
  financeTxnType!: SettlementFinanceTxnType;

  @ApiProperty({ format: 'uuid', description: 'Payment id when financeTxnType=PAYMENT' })
  @IsUUID()
  financeTxnId!: string;

  @ApiProperty({
    example: '200000000',
    description: 'Obligation-currency amount settled',
  })
  @IsString()
  amount!: string;

  @ApiPropertyOptional({
    description: 'Payment-currency amount (defaults to amount when same-currency)',
  })
  @IsOptional()
  @IsString()
  paymentAmount?: string;

  @ApiPropertyOptional({
    type: SettlementFxDto,
    description: 'Required for cross-currency (e.g. IRR payment → USD obligation)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettlementFxDto)
  fx?: SettlementFxDto;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}
