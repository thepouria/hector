import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PARTY_DISPLAY_NAME_MAX_LENGTH,
  PARTY_ID_FIELD_MAX_LENGTH,
  PARTY_LEGAL_NAME_MAX_LENGTH,
  PARTY_NOTES_MAX_LENGTH,
  PARTY_PERSON_NAME_MAX_LENGTH,
  PARTY_TRADE_NAME_MAX_LENGTH,
} from '../party.constants';

/** Identity update only. type / partyCode / companyId are not client-writable. */
export class UpdatePartyDto {
  @ApiPropertyOptional({ maxLength: PARTY_DISPLAY_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_DISPLAY_NAME_MAX_LENGTH)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: PARTY_PERSON_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_PERSON_NAME_MAX_LENGTH)
  firstName?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_PERSON_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_PERSON_NAME_MAX_LENGTH)
  lastName?: string | null;

  @ApiPropertyOptional({ description: 'ISO date YYYY-MM-DD or null to clear' })
  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_LEGAL_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_LEGAL_NAME_MAX_LENGTH)
  legalName?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_TRADE_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_TRADE_NAME_MAX_LENGTH)
  tradeName?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ID_FIELD_MAX_LENGTH)
  nationalId?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ID_FIELD_MAX_LENGTH)
  registrationNumber?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_ID_FIELD_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_ID_FIELD_MAX_LENGTH)
  taxId?: string | null;

  @ApiPropertyOptional({ maxLength: PARTY_NOTES_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PARTY_NOTES_MAX_LENGTH)
  notes?: string | null;
}
