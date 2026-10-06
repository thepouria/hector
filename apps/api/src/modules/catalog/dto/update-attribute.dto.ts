import { ApiPropertyOptional } from '@nestjs/swagger';
import { AttributeType } from '@hector/database';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ATTRIBUTE_DESCRIPTION_MAX_LENGTH,
  ATTRIBUTE_NAME_MAX_LENGTH,
  ATTRIBUTE_UNIT_MAX_LENGTH,
} from '../catalog.constants';

export class UpdateAttributeDto {
  @ApiPropertyOptional({ maxLength: ATTRIBUTE_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTE_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ maxLength: ATTRIBUTE_UNIT_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTE_UNIT_MAX_LENGTH)
  unit?: string | null;

  @ApiPropertyOptional({ maxLength: ATTRIBUTE_DESCRIPTION_MAX_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTE_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ enum: AttributeType })
  @IsOptional()
  @IsEnum(AttributeType)
  type?: AttributeType;
}
