import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SalesChannelType } from '@hector/database';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SALES_CHANNEL_CODE_MAX_LENGTH,
  SALES_CHANNEL_NAME_MAX_LENGTH,
  SALES_CHANNEL_NOTES_MAX_LENGTH,
} from '../sales.constants';

export class CreateSalesChannelDto {
  @ApiProperty({ example: 'KHANOUMI', maxLength: SALES_CHANNEL_CODE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(SALES_CHANNEL_CODE_MAX_LENGTH)
  code!: string;

  @ApiProperty({ example: 'Khanoumi', maxLength: SALES_CHANNEL_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(SALES_CHANNEL_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ enum: SalesChannelType, example: SalesChannelType.MARKETPLACE })
  @IsEnum(SalesChannelType)
  type!: SalesChannelType;

  @ApiPropertyOptional({ maxLength: SALES_CHANNEL_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(SALES_CHANNEL_NOTES_MAX_LENGTH)
  notes?: string;
}
