import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartyContactPointType } from '@hector/database';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PARTY_CONTACT_LABEL_MAX_LENGTH,
  PARTY_CONTACT_VALUE_MAX_LENGTH,
} from '../party.constants';

export class CreatePartyContactDto {
  @ApiProperty({ enum: PartyContactPointType })
  @IsEnum(PartyContactPointType)
  type!: PartyContactPointType;

  @ApiProperty({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  value!: string;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_LABEL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_LABEL_MAX_LENGTH)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdatePartyContactDto {
  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  value?: string;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_LABEL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_LABEL_MAX_LENGTH)
  label?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
