import {
  deriveDueStatus,
  parseUtcBusinessDate,
  toUtcBusinessDate,
  utcBusinessDateKey,
  utcCalendarDaysBetween,
} from './purchase-order-due';
import { calculateDueDateFromOrderDate } from './purchase-order-terms';

describe('purchase-order-due', () => {
  it('adds calendar days across month and year boundaries', () => {
    expect(
      utcBusinessDateKey(
        calculateDueDateFromOrderDate(new Date('2026-10-03T11:00:00.000Z'), 10),
      ),
    ).toBe('2026-10-13');
    expect(
      utcBusinessDateKey(
        calculateDueDateFromOrderDate(new Date('2026-10-25T08:00:00.000Z'), 10),
      ),
    ).toBe('2026-11-04');
    expect(
      utcBusinessDateKey(
        calculateDueDateFromOrderDate(new Date('2026-12-25T08:00:00.000Z'), 10),
      ),
    ).toBe('2027-01-04');
  });

  it('handles leap-year calendar addition', () => {
    expect(
      utcBusinessDateKey(
        calculateDueDateFromOrderDate(new Date('2024-02-28T12:00:00.000Z'), 1),
      ),
    ).toBe('2024-02-29');
    expect(
      utcBusinessDateKey(
        calculateDueDateFromOrderDate(new Date('2024-02-29T12:00:00.000Z'), 1),
      ),
    ).toBe('2024-03-01');
  });

  it('keeps business date keys stable through noon normalization', () => {
    const due = calculateDueDateFromOrderDate(new Date('2026-10-03T23:30:00.000Z'), 10);
    expect(utcBusinessDateKey(due)).toBe('2026-10-13');
    expect(utcBusinessDateKey(toUtcBusinessDate(due))).toBe('2026-10-13');
    expect(utcBusinessDateKey(parseUtcBusinessDate('2026-10-13'))).toBe('2026-10-13');
  });

  it('derives due status from fixed current date with 3-day soon threshold', () => {
    const now = new Date('2026-10-03T15:00:00.000Z');
    expect(deriveDueStatus(null, now)).toBe('NO_DUE_DATE');
    expect(deriveDueStatus(parseUtcBusinessDate('2026-10-10'), now)).toBe('UPCOMING');
    expect(deriveDueStatus(parseUtcBusinessDate('2026-10-06'), now)).toBe('DUE_SOON');
    expect(deriveDueStatus(parseUtcBusinessDate('2026-10-03'), now)).toBe('DUE_TODAY');
    expect(deriveDueStatus(parseUtcBusinessDate('2026-10-02'), now)).toBe('OVERDUE');
  });

  it('counts UTC calendar days without floating-point drift', () => {
    expect(
      utcCalendarDaysBetween(
        parseUtcBusinessDate('2026-10-03'),
        parseUtcBusinessDate('2026-10-13'),
      ),
    ).toBe(10);
  });
});
