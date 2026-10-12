import { describe, expect, it } from 'vitest';
import { parseQuietHours } from '../../src/core/quietHours';

describe('parseQuietHours', () => {
  it('parses a same-day window into minutes since midnight', () => {
    expect(parseQuietHours('09:15-17:00')).toEqual({ start: 9 * 60 + 15, end: 17 * 60 });
  });

  it('parses a window that crosses midnight', () => {
    expect(parseQuietHours('22:00-07:30')).toEqual({ start: 22 * 60, end: 7 * 60 + 30 });
  });

  it('accepts the extremes of the day', () => {
    expect(parseQuietHours('00:00-23:59')).toEqual({ start: 0, end: 23 * 60 + 59 });
    expect(parseQuietHours('23:59-00:00')).toEqual({ start: 23 * 60 + 59, end: 0 });
  });

  it('accepts single-digit hours', () => {
    expect(parseQuietHours('7:05-9:30')).toEqual({ start: 7 * 60 + 5, end: 9 * 60 + 30 });
  });

  it('ignores whitespace at the ends and around the dash', () => {
    expect(parseQuietHours('  22:00 - 07:30 ')).toEqual({ start: 1320, end: 450 });
    expect(parseQuietHours('22:00\t-\t07:30')).toEqual({ start: 1320, end: 450 });
  });

  it('rejects out-of-range hours and minutes', () => {
    for (const text of ['24:00-07:00', '22:00-25:00', '22:60-07:00', '22:00-07:99']) {
      expect(parseQuietHours(text), text).toBeUndefined();
    }
  });

  it('requires exactly two minute digits and one or two hour digits', () => {
    for (const text of ['22:0-07:00', '22:000-07:00', '022:00-07:00', '22-07', ':30-07:00']) {
      expect(parseQuietHours(text), text).toBeUndefined();
    }
  });

  it('rejects an empty window (start equals end)', () => {
    expect(parseQuietHours('08:00-08:00')).toBeUndefined();
    expect(parseQuietHours('8:00-08:00')).toBeUndefined();
  });

  it('rejects anything else', () => {
    for (const text of ['', '   ', 'night', '22:00', '22:00-', '-07:00', '22:00-07:00-09:00', '22:00 07:00', '22.00-07.00', 'a2:00-07:00', '+1:00-07:00', '22:00–07:30']) {
      expect(parseQuietHours(text), JSON.stringify(text)).toBeUndefined();
    }
  });
});
