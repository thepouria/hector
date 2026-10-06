import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PutCategoryAttributeItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  attributeId!: string;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}

export class PutCategoryAttributesDto {
  @ApiProperty({ type: [PutCategoryAttributeItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PutCategoryAttributeItemDto)
  @ArrayMaxSize(500)
  attributes!: PutCategoryAttributeItemDto[];
}
