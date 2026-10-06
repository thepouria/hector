import 'reflect-metadata';
import { validate } from 'class-validator';
import { IsDateString, IsOptional } from 'class-validator';
import { IsDateRangeStart } from './date-range.constraint';

class SampleRangeQuery {
  @IsOptional()
  @IsDateString()
  @IsDateRangeStart('to')
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

describe('IsDateRangeStart', () => {
  it('accepts missing bounds', async () => {
    const dto = new SampleRangeQuery();
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts from <= to', async () => {
    const dto = Object.assign(new SampleRangeQuery(), {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects from > to', async () => {
    const dto = Object.assign(new SampleRangeQuery(), {
      from: '2026-02-01T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain('must be less than or equal');
  });
});
