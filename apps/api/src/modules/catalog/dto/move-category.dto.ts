import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class MoveCategoryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'New parent category id. Null/omit-as-null means move to root.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  parentId?: string | null;
}
