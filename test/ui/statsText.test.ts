import { describe, expect, it } from 'vitest';
import type { PracticeStats } from '../../src/core/stats';
import { formatStats } from '../../src/ui/statsText';

const base: PracticeStats = {
  offered: 0, passed: 0, gaveUp: 0, declined: 0, passRate: undefined, streakDays: 0, concepts: [],
};

describe('formatStats', () => {
  it('renders an empty history', () => {
    expect(formatStats(base)).toEqual([
      'Streak: none yet (pass a challenge today to start one)',
      'No finished challenges yet',
      'Offered 0, declined 0',
    ]);
  });

  it('renders streak, pass rate and top five concepts', () => {
    const concepts = ['a', 'b', 'c', 'd', 'e', 'f'].map((concept) => ({ concept, passed: 1, attempted: 2 }));
    const lines = formatStats({
      ...base, offered: 9, passed: 5, gaveUp: 2, declined: 2, passRate: 5 / 7, streakDays: 3, concepts,
    });
    expect(lines).toEqual([
      'Streak: 3 days',
      'Passed 5 of 7 finished (71%)',
      'Offered 9, declined 2',
      'Top concepts: a 1/2, b 1/2, c 1/2, d 1/2, e 1/2',
    ]);
  });

  it('uses the singular for a one-day streak', () => {
    expect(formatStats({ ...base, streakDays: 1 })[0]).toBe('Streak: 1 day');
  });
});
