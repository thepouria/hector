import 'reflect-metadata';
import { buildPaginationMeta } from './pagination-query.dto';

describe('buildPaginationMeta', () => {
  it('computes totalPages from total and pageSize', () => {
    expect(buildPaginationMeta(1, 20, 0)).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      totalPages: 0,
    });
    expect(buildPaginationMeta(1, 20, 41)).toEqual({
      page: 1,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
    expect(buildPaginationMeta(2, 10, 25)).toEqual({
      page: 2,
      pageSize: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it('returns totalPages 0 when pageSize is 0', () => {
    expect(buildPaginationMeta(1, 0, 100).totalPages).toBe(0);
  });
});
