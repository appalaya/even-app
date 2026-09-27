import { describe, expect, it } from 'vitest';

import { monthGrid, monthTitle, shiftIso, weekdayLetters } from './calendar';

describe('calendar', () => {
  it('lays September 2026 out as the date sheet draws it: the 1st on a Tuesday, five weeks', () => {
    const weeks = monthGrid('2026-09');
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      null,
      null,
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
    expect(weeks[3]?.[6]).toBe('2026-09-26');
    expect(weeks[4]).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      null,
      null,
      null,
    ]);
  });

  it('moves across month and year ends', () => {
    expect(shiftIso('2026-09-01', -1)).toBe('2026-08-31');
    expect(shiftIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftIso('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('names the month and the weekdays, Sunday first', () => {
    expect(monthTitle('2026-09', 'en-US')).toBe('September 2026');
    expect(weekdayLetters('en-US')).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  });
});
