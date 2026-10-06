import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { SKU_CODE_MAX_LENGTH, SKU_NAME_MAX_LENGTH } from '../catalog.constants';

export class UpdateSkuDto {
  @ApiPropertyOptional({
    description:
      'SKU code changes are sensitive operational identity updates and are audited. Prefer stability.',
    maxLength: SKU_CODE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(SKU_CODE_MAX_LENGTH)
  code?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: SKU_NAME_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(SKU_NAME_MAX_LENGTH)
  name?: string | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Replace the variant selection (exactly one value per option). Signature is recomputed.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  optionValueIds?: string[];
}
