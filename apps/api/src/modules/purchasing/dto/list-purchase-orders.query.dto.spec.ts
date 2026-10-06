import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListPurchaseOrdersQueryDto } from './list-purchase-orders.query.dto';

describe('ListPurchaseOrdersQueryDto', () => {
  function parse(input: Record<string, unknown>): ListPurchaseOrdersQueryDto {
    return plainToInstance(ListPurchaseOrdersQueryDto, input);
  }

  it('applies pagination defaults and whitelisted sort', async () => {
    const dto = parse({});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
    expect(dto.sortBy).toBe('orderDate');
  });

  it('rejects unbounded pageSize', async () => {
    const dto = parse({ pageSize: 999999 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'pageSize')).toBe(true);
  });

  it('rejects unsupported sortBy', async () => {
    const dto = parse({ sortBy: 'passwordHash' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sortBy')).toBe(true);
  });

  it('rejects invalid status enum', async () => {
    const dto = parse({ status: 'PAID' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('rejects inverted due date range', async () => {
    const dto = parse({
      dueFrom: '2026-12-01',
      dueTo: '2026-01-01',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'dueFrom')).toBe(true);
  });

  it('rejects inverted createdAt range', async () => {
    const dto = parse({
      createdFrom: '2026-06-01T00:00:00.000Z',
      createdTo: '2026-01-01T00:00:00.000Z',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'createdFrom')).toBe(true);
  });

  it('caps search length', async () => {
    const dto = parse({ search: 'x'.repeat(201) });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'search')).toBe(true);
  });
});
