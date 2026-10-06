import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { LOCATION_BARCODE_MAX_LENGTH } from '../warehouse-location.constants';

export class ResolveLocationBarcodeDto {
  @ApiProperty({ example: 'LOC-7F4K9D2M', minLength: 1, maxLength: LOCATION_BARCODE_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(LOCATION_BARCODE_MAX_LENGTH)
  value!: string;
}
