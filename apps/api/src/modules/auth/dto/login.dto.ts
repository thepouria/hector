import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../auth.constants';

export class LoginDto {
  @ApiProperty({ example: 'pouria@hector.local' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(MAX_PASSWORD_LENGTH)
  password!: string;
}
