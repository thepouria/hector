import { ApiProperty } from '@nestjs/swagger';
import { PartyRoleType } from '@hector/database';
import { IsEnum } from 'class-validator';

export class AddPartyRoleDto {
  @ApiProperty({ enum: PartyRoleType })
  @IsEnum(PartyRoleType)
  roleType!: PartyRoleType;
}
