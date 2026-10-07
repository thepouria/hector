import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartyAddressType } from '@hector/database';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PARTY_ADDRESS_GEO_MAX_LENGTH,
  PARTY_ADDRESS_LABEL_MAX_LENGTH,
  PARTY_ADDRESS_LINE_MAX_LENGTH,
  PARTY_ADDRESS_NOTES_MAX_LENGTH,
  PARTY_ADDRESS_POSTAL_MAX_LENGTH,
  PARTY_ADDRESS_RECIPIENT_MAX_LENGTH,
  PARTY_CONTACT_VALUE_MAX_LENGTH,
} from '../party.constants';

export class CreatePartyAddressDto {
  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_LABEL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_LABEL_MAX_LENGTH)
  label?: string;

  @ApiPropertyOptional({ enum: PartyAddressType })
  @IsOptional()
  @IsEnum(PartyAddressType)
  type?: PartyAddressType;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  country?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  province?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  city?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  district?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_POSTAL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_POSTAL_MAX_LENGTH)
  postalCode?: string;

  @ApiProperty({ maxLength: PARTY_ADDRESS_LINE_MAX_LENGTH })
  @IsString()
  @MaxLength(PARTY_ADDRESS_LINE_MAX_LENGTH)
  addressLine1!: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_LINE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_LINE_MAX_LENGTH)
  addressLine2?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_RECIPIENT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_RECIPIENT_MAX_LENGTH)
  recipientName?: string;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  recipientPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_NOTES_MAX_LENGTH)
  notes?: string;
}

export class UpdatePartyAddressDto {
  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_LABEL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_LABEL_MAX_LENGTH)
  label?: string | null;

  @ApiPropertyOptional({ enum: PartyAddressType })
  @IsOptional()
  @IsEnum(PartyAddressType)
  type?: PartyAddressType;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  country?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  province?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  city?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_GEO_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_GEO_MAX_LENGTH)
  district?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_POSTAL_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_POSTAL_MAX_LENGTH)
  postalCode?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_LINE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_LINE_MAX_LENGTH)
  addressLine1?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_LINE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_LINE_MAX_LENGTH)
  addressLine2?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_RECIPIENT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_RECIPIENT_MAX_LENGTH)
  recipientName?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  recipientPhone?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ maxLength: PARTY_ADDRESS_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ADDRESS_NOTES_MAX_LENGTH)
  notes?: string | null;
}
