import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BARCODE_VALUE_MAX_LENGTH } from '../catalog.constants';

export class ResolveBarcodeDto {
  @ApiProperty({ example: '4006381333931', maxLength: BARCODE_VALUE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BARCODE_VALUE_MAX_LENGTH)
  value!: string;
}
