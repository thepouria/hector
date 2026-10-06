import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { SUPPLIER_NOTE_BODY_MAX_LENGTH } from '../purchasing.constants';

export class CreateSupplierNoteDto {
  @ApiProperty({
    example: 'برای سفارش بعدی ۱۰ روزه تسویه می‌کند.',
    maxLength: SUPPLIER_NOTE_BODY_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(SUPPLIER_NOTE_BODY_MAX_LENGTH)
  body!: string;
}
