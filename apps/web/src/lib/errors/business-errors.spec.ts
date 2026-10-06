import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/lib/api/errors';
import { formatRequestIdHint, mapBusinessError } from './business-errors';

describe('business error mapping', () => {
  it('maps LAST_OWNER_REQUIRED', () => {
    const error = new ApiClientError({
      status: 409,
      code: 'LAST_OWNER_REQUIRED',
      message: 'raw',
    });
    expect(mapBusinessError(error)).toContain('مالک فعال');
  });

  it('maps ROLE_PERMISSION_ESCALATION', () => {
    const error = new ApiClientError({
      status: 403,
      code: 'ROLE_PERMISSION_ESCALATION',
      message: 'raw',
    });
    expect(mapBusinessError(error)).toContain('بالاتر از سطح دسترسی');
  });

  it('falls back for unknown codes', () => {
    const error = new ApiClientError({
      status: 500,
      code: 'SOMETHING_NEW',
      message: 'server says this',
    });
    expect(mapBusinessError(error)).toBe('server says this');
  });

  it('formats request id hint', () => {
    expect(formatRequestIdHint('abc123')).toBe('شناسه خطا: abc123');
    expect(formatRequestIdHint(null)).toBeNull();
  });

  it('maps purchasing domain errors to Persian', () => {
    const cases: Array<[string, string]> = [
      ['PURCHASE_CORRECTION_NOT_ALLOWED', 'اصلاح'],
      ['PURCHASE_ORDER_VERSION_CONFLICT', 'تازه‌سازی'],
      ['PURCHASE_SHORT_CLOSE_NOT_ALLOWED', 'تأمین'],
      ['PURCHASE_RETURN_EMPTY', 'قلم'],
      ['PURCHASE_ORDER_NOT_EDITABLE', 'ویرایش'],
    ];
    for (const [code, fragment] of cases) {
      const error = new ApiClientError({ status: 409, code, message: 'raw' });
      expect(mapBusinessError(error)).toContain(fragment);
    }
  });
});
