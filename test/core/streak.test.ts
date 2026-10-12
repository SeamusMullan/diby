import { describe, expect, it } from 'vitest';
import { currentStreak } from '../../src/core/stats';
import type { ChallengeStatus, HistoryEntry } from '../../src/types';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** 2026-10-12T12:00:00Z */
const NOW = Date.UTC(2026, 9, 12, 12);

let n = 0;
const entry = (at: number, status: ChallengeStatus = 'passed', extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: `e${n++}`, createdAt: at, finishedAt: at, status, offered: true,
  symbol: 's', language: 'python', concepts: [], difficulty: 2, ...extra,
});

describe('currentStreak', () => {
  it('is 0 for empty history', () => {
    expect(currentStreak([], NOW, 0)).toBe(0);
  });

  it('counts a single pass today', () => {
    expect(currentStreak([entry(NOW - HOUR)], NOW, 0)).toBe(1);
  });

  it('counts consecutive days ending today', () => {
    const h = [entry(NOW - 2 * DAY), entry(NOW - DAY), entry(NOW - HOUR)];
    expect(currentStreak(h, NOW, 0)).toBe(3);
  });

  it('keeps the streak alive when the last pass was yesterday', () => {
    const h = [entry(NOW - 2 * DAY), entry(NOW - DAY)];
    expect(currentStreak(h, NOW, 0)).toBe(2);
  });

  it('is 0 when the last pass was two or more days ago', () => {
    expect(currentStreak([entry(NOW - 2 * DAY), entry(NOW - 3 * DAY)], NOW, 0)).toBe(0);
  });

  it('stops at the first missing day', () => {
    const h = [entry(NOW - 4 * DAY), entry(NOW - 3 * DAY), entry(NOW - DAY), entry(NOW)];
    expect(currentStreak(h, NOW, 0)).toBe(2);
  });

  it('counts several passes on one day once', () => {
    const h = [entry(NOW - DAY), entry(NOW - DAY + HOUR), entry(NOW - 2 * HOUR), entry(NOW - HOUR)];
    expect(currentStreak(h, NOW, 0)).toBe(2);
  });

  it('does not require entries to be sorted', () => {
    const h = [entry(NOW), entry(NOW - 2 * DAY), entry(NOW - DAY)];
    expect(currentStreak(h, NOW, 0)).toBe(3);
  });

  it('only counts passed challenges', () => {
    const h = [
      entry(NOW - 2 * DAY),
      entry(NOW - DAY, 'gave_up'),
      entry(NOW - DAY, 'declined'),
      entry(NOW - DAY, 'cancelled'),
      entry(NOW - HOUR),
    ];
    expect(currentStreak(h, NOW, 0)).toBe(1);
    expect(currentStreak([entry(NOW, 'active'), entry(NOW, 'pending')], NOW, 0)).toBe(0);
  });

  it('uses finishedAt rather than createdAt when present', () => {
    // Offered late yesterday, solved this morning: counts for today only.
    const h = [entry(NOW - DAY, 'passed', { finishedAt: NOW - HOUR })];
    expect(currentStreak(h, NOW, 0)).toBe(1);
    expect(currentStreak([entry(NOW - 3 * DAY, 'passed', { finishedAt: NOW })], NOW, 0)).toBe(1);
  });

  it('falls back to createdAt when finishedAt is missing', () => {
    const h = [entry(NOW - DAY, 'passed', { finishedAt: undefined }), entry(NOW, 'passed', { finishedAt: undefined })];
    expect(currentStreak(h, NOW, 0)).toBe(2);
  });

  it('buckets days by local time, not UTC', () => {
    // now = 2026-10-12 00:30 local in UTC+2 (= 10-11 22:30Z). Passes at 23:00 and 23:50 local on 10-11.
    const now = Date.UTC(2026, 9, 11, 22, 30);
    const h = [entry(Date.UTC(2026, 9, 11, 21)), entry(Date.UTC(2026, 9, 11, 21, 50))];
    // In UTC both passes and "now" fall on 10-11 → streak of 1 ending today.
    expect(currentStreak(h, now, 0)).toBe(1);
    // In UTC+2 the passes are on 10-11 and now is 10-12 → still 1 (ending yesterday).
    expect(currentStreak(h, now, 120)).toBe(1);
    // Two UTC days that are the same local day in UTC-5 count once.
    const late = [entry(Date.UTC(2026, 9, 12, 1)), entry(Date.UTC(2026, 9, 11, 15))];
    expect(currentStreak(late, Date.UTC(2026, 9, 12, 2), -300)).toBe(1);
    expect(currentStreak(late, Date.UTC(2026, 9, 12, 2), 0)).toBe(2);
  });

  it('ignores passes dated in the future (clock skew)', () => {
    expect(currentStreak([entry(NOW + 3 * DAY)], NOW, 0)).toBe(0);
    expect(currentStreak([entry(NOW + 3 * DAY), entry(NOW - HOUR)], NOW, 0)).toBe(1);
  });
});
