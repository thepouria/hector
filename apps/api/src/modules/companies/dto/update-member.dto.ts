import { ApiProperty } from '@nestjs/swagger';
import { CompanyMemberStatus } from '@hector/database';
import { IsIn } from 'class-validator';

const MEMBER_STATUS_UPDATE = [
  CompanyMemberStatus.ACTIVE,
  CompanyMemberStatus.SUSPENDED,
] as const;

export class UpdateMemberDto {
  @ApiProperty({ enum: MEMBER_STATUS_UPDATE })
  @IsIn(MEMBER_STATUS_UPDATE)
  status!: (typeof MEMBER_STATUS_UPDATE)[number];
}
