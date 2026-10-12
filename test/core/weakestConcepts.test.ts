import { describe, expect, it } from 'vitest';
import { type ConceptStats, weakestConcepts } from '../../src/core/stats';

const c = (concept: string, passed: number, attempted: number): ConceptStats => ({ concept, passed, attempted });
const names = (list: ConceptStats[]) => list.map((x) => x.concept);

describe('weakestConcepts', () => {
  it('returns [] for no concepts', () => {
    expect(weakestConcepts([], 2, 3)).toEqual([]);
  });

  it('orders by pass rate, lowest first', () => {
    const input = [c('parsing', 3, 4), c('regex', 0, 3), c('dates', 1, 2)];
    expect(names(weakestConcepts(input, 1, 10))).toEqual(['regex', 'dates', 'parsing']);
  });

  it('compares rates, not raw failure counts', () => {
    // b failed 3 times but passes 40% of the time; a failed once and passes 0%: a is weaker.
    expect(names(weakestConcepts([c('b', 2, 5), c('a', 0, 1)], 1, 10))).toEqual(['a', 'b']);
  });

  it('breaks rate ties by more attempts first, then by name', () => {
    const input = [c('zeta', 1, 2), c('alpha', 2, 4), c('beta', 1, 2)];
    expect(names(weakestConcepts(input, 1, 10))).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('skips concepts with fewer than minAttempts attempts', () => {
    const input = [c('once', 0, 1), c('twice', 0, 2)];
    expect(names(weakestConcepts(input, 2, 10))).toEqual(['twice']);
  });

  it('skips concepts that were never failed', () => {
    const input = [c('perfect', 5, 5), c('shaky', 4, 5)];
    expect(names(weakestConcepts(input, 1, 10))).toEqual(['shaky']);
  });

  it('returns at most limit entries, and none for limit <= 0', () => {
    const input = [c('a', 0, 2), c('b', 0, 3), c('c', 1, 2), c('d', 1, 3)];
    expect(names(weakestConcepts(input, 1, 2))).toEqual(['b', 'a']);
    expect(weakestConcepts(input, 1, 0)).toEqual([]);
    expect(weakestConcepts(input, 1, -1)).toEqual([]);
  });

  it('returns the entries themselves and does not reorder the input', () => {
    const input = [c('ok', 3, 4), c('bad', 0, 2)];
    const before = [...input];
    const out = weakestConcepts(input, 1, 10);
    expect(input).toEqual(before);
    expect(out[0]).toBe(input[1]);
  });
});
