import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartyType } from '@hector/database';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  PARTY_CONTACT_VALUE_MAX_LENGTH,
  PARTY_DISPLAY_NAME_MAX_LENGTH,
  PARTY_ID_FIELD_MAX_LENGTH,
} from '../party.constants';

/**
 * Read-only duplicate detection input. Never triggers merge.
 * Name is accepted for UX context only — name-only never creates a match.
 */
export class PartyDuplicateCheckDto {
  @ApiPropertyOptional({ enum: PartyType })
  @IsOptional()
  @IsEnum(PartyType)
  type?: PartyType;

  @ApiPropertyOptional({ maxLength: PARTY_DISPLAY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ID_FIELD_MAX_LENGTH)
  nationalId?: string;

  @ApiPropertyOptional({ maxLength: PARTY_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ID_FIELD_MAX_LENGTH)
  registrationNumber?: string;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  mobile?: string;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  phone?: string;

  @ApiPropertyOptional({ maxLength: PARTY_CONTACT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_CONTACT_VALUE_MAX_LENGTH)
  email?: string;

  @ApiPropertyOptional({ description: 'Exclude this Party from matches (e.g. while editing)' })
  @IsOptional()
  @IsUUID()
  excludePartyId?: string;
}
