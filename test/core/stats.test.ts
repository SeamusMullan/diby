import { describe, expect, it } from 'vitest';
import { computeStats } from '../../src/core/stats';
import type { ChallengeStatus, HistoryEntry } from '../../src/types';

const NOW = Date.UTC(2026, 9, 12, 12);

let n = 0;
const entry = (status: ChallengeStatus, concepts: string[] = [], offered = true): HistoryEntry => ({
  id: `e${n++}`, createdAt: NOW - 1000, finishedAt: NOW - 1000, status, offered,
  symbol: 's', language: 'python', concepts, difficulty: 2,
});

describe('computeStats', () => {
  it('handles empty history', () => {
    expect(computeStats([], NOW, 0)).toEqual({
      offered: 0, passed: 0, gaveUp: 0, declined: 0, passRate: undefined, streakDays: 0, concepts: [], needsPractice: [],
    });
  });

  it('counts only offered entries and computes the pass rate over finished ones', () => {
    const s = computeStats(
      [
        entry('passed'), entry('passed'), entry('passed'), entry('gave_up'),
        entry('declined'), entry('cancelled'), entry('declined_by_policy', [], false),
      ],
      NOW,
      0,
    );
    expect(s).toMatchObject({ offered: 6, passed: 3, gaveUp: 1, declined: 1, passRate: 0.75, streakDays: 1 });
  });

  it('aggregates normalised concepts over attempted challenges, most passed first', () => {
    const s = computeStats(
      [
        entry('passed', ['Parsing', 'regex']),
        entry('passed', ['parsing']),
        entry('gave_up', ['regex', 'date_handling']),
        entry('declined', ['recursion']),
        entry('passed', ['dup', 'Dup']),
      ],
      NOW,
      0,
    );
    expect(s.concepts).toEqual([
      { concept: 'parsing', passed: 2, attempted: 2 },
      { concept: 'regex', passed: 1, attempted: 2 },
      { concept: 'dup', passed: 1, attempted: 1 },
      { concept: 'date-handling', passed: 0, attempted: 1 },
    ]);
    expect(s.needsPractice).toEqual([{ concept: 'regex', passed: 1, attempted: 2 }]);
  });
});
