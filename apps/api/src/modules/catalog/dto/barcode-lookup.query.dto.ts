import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { BARCODE_VALUE_MAX_LENGTH } from '../catalog.constants';

export class BarcodeLookupQueryDto {
  @ApiProperty({ example: 'DEV-BC-FAN-SL-01', maxLength: BARCODE_VALUE_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(BARCODE_VALUE_MAX_LENGTH)
  value!: string;
}
