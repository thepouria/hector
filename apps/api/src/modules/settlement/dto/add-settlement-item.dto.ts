import { ApiProperty } from '@nestjs/swagger';
import { SettlementSourceType } from '@hector/database';
import { IsEnum, IsUUID } from 'class-validator';

export class AddSettlementItemDto {
  @ApiProperty({
    enum: SettlementSourceType,
    description: 'Phase 6.1 allocate-enabled: MANUAL_OBLIGATION only',
  })
  @IsEnum(SettlementSourceType)
  sourceType!: SettlementSourceType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceId!: string;
}
