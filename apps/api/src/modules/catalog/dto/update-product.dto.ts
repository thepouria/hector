import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import {
  PRODUCT_CODE_MAX_LENGTH,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
} from '../catalog.constants';

/**
 * PATCH semantics: omitted → unchanged; null → clear optional relation/value; value → update.
 * Status changes use dedicated activate / deactivate / archive endpoints.
 */
export class UpdateProductDto {
  @ApiPropertyOptional({ maxLength: PRODUCT_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(PRODUCT_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description: 'Pass null to clear. Empty string is rejected.',
    nullable: true,
    maxLength: PRODUCT_CODE_MAX_LENGTH,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PRODUCT_CODE_MAX_LENGTH)
  code?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: PRODUCT_DESCRIPTION_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(PRODUCT_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  brandId?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  categoryId?: string | null;
}
