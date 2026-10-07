import { ApiPropertyOptional } from '@nestjs/swagger';
import { SalesChannelType } from '@hector/database';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SALES_CHANNEL_CODE_MAX_LENGTH,
  SALES_CHANNEL_NAME_MAX_LENGTH,
  SALES_CHANNEL_NOTES_MAX_LENGTH,
} from '../sales.constants';

export class UpdateSalesChannelDto {
  @ApiPropertyOptional({ maxLength: SALES_CHANNEL_CODE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_CHANNEL_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({ maxLength: SALES_CHANNEL_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_CHANNEL_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ enum: SalesChannelType })
  @IsOptional()
  @IsEnum(SalesChannelType)
  type?: SalesChannelType;

  @ApiPropertyOptional({ maxLength: SALES_CHANNEL_NOTES_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_CHANNEL_NOTES_MAX_LENGTH)
  notes?: string | null;
}
