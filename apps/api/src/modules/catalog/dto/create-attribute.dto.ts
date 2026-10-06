import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttributeScope, AttributeType } from '@hector/database';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  ATTRIBUTE_CODE_MAX_LENGTH,
  ATTRIBUTE_DESCRIPTION_MAX_LENGTH,
  ATTRIBUTE_NAME_MAX_LENGTH,
  ATTRIBUTE_UNIT_MAX_LENGTH,
} from '../catalog.constants';

export class CreateAttributeDto {
  @ApiProperty({ example: 'Volume', maxLength: ATTRIBUTE_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ATTRIBUTE_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({ example: 'volume', maxLength: ATTRIBUTE_CODE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ATTRIBUTE_CODE_MAX_LENGTH)
  code!: string;

  @ApiProperty({ enum: AttributeType })
  @IsEnum(AttributeType)
  type!: AttributeType;

  @ApiProperty({ enum: AttributeScope })
  @IsEnum(AttributeScope)
  scope!: AttributeScope;

  @ApiPropertyOptional({ example: 'ml', maxLength: ATTRIBUTE_UNIT_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTE_UNIT_MAX_LENGTH)
  unit?: string;

  @ApiPropertyOptional({ maxLength: ATTRIBUTE_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTE_DESCRIPTION_MAX_LENGTH)
  description?: string;
}
