import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ATTRIBUTE_TEXT_VALUE_MAX_LENGTH } from '../catalog.constants';

export class PutEntityAttributeItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  attributeId!: string;

  @ApiPropertyOptional({ maxLength: ATTRIBUTE_TEXT_VALUE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(ATTRIBUTE_TEXT_VALUE_MAX_LENGTH)
  textValue?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  numberValue?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  booleanValue?: boolean | null;

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  optionIds?: string[] | null;
}

export class PutEntityAttributesDto {
  @ApiProperty({ type: [PutEntityAttributeItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PutEntityAttributeItemDto)
  @ArrayMaxSize(500)
  attributes!: PutEntityAttributeItemDto[];
}
