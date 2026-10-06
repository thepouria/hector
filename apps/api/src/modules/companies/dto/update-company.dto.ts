import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCompanyDto {
  @ApiPropertyOptional({ example: 'Pishteh' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'Asia/Tehran' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timezone?: string;
}
