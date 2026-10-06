import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';
import { VARIANT_GENERATION_MAX, VARIANT_VALUE_MAX_LENGTH } from '../catalog.constants';

export class CreateVariantValuesDto {
  @ApiProperty({
    type: [String],
    example: ['01', '02', '03'],
    description: 'Batch of value labels. Duplicates (after normalization) are collapsed.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(VARIANT_GENERATION_MAX)
  @IsString({ each: true })
  @MaxLength(VARIANT_VALUE_MAX_LENGTH, { each: true })
  values!: string[];
}
