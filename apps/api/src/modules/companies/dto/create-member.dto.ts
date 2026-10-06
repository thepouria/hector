import { IsEmail, IsUUID, ArrayMinSize, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CreateMemberDto {
  @ApiProperty({ example: 'person@example.com' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({
    type: [String],
    description: 'Role UUIDs that must belong to the current company',
    example: ['11111111-1111-1111-1111-111111111111'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  roleIds!: string[];
}
