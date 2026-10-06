import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateCompanyDto } from './update-company.dto';
import { UpdateMemberDto } from './update-member.dto';
import { CompanyMemberStatus } from '@hector/database';

describe('Company DTOs', () => {
  it('accepts a valid timezone string shape on UpdateCompanyDto', async () => {
    const dto = plainToInstance(UpdateCompanyDto, {
      name: 'Pishteh',
      timezone: 'Asia/Tehran',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid member status values', async () => {
    const dto = plainToInstance(UpdateMemberDto, { status: 'REMOVED' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts ACTIVE and SUSPENDED member status updates', async () => {
    for (const status of [CompanyMemberStatus.ACTIVE, CompanyMemberStatus.SUSPENDED]) {
      const dto = plainToInstance(UpdateMemberDto, { status });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });
});
