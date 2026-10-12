import { describe, expect, it } from 'vitest';
import { decide, MODE_MIN_INTERVAL_MS } from '../../src/core/policy';
import type { HistoryEntry, PolicyCandidate, PolicySettings } from '../../src/types';

const MIN = 60_000;
const NOW = 1_000_000_000_000;
const cand = (over: Partial<PolicyCandidate> = {}): PolicyCandidate => ({
  concepts: ['parsing'],
  difficulty: 3,
  language: 'python',
  symbol: 'f',
  ...over,
});
const settings = (over: Partial<PolicySettings> = {}): PolicySettings => ({
  mode: 'steady',
  focusConcepts: [],
  avoidConcepts: [],
  maxDifficulty: 5,
  ...over,
});
const entry = (ageMs: number, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: String(Math.random()),
  createdAt: NOW - ageMs,
  status: 'passed',
  offered: true,
  symbol: 'x',
  language: 'python',
  concepts: [],
  difficulty: 3,
  ...over,
});

describe('decide', () => {
  it('declines in off mode', () => {
    expect(decide(cand(), [], settings({ mode: 'off' }), NOW).decision).toBe('decline');
  });
  it('accepts with empty history', () => {
    for (const mode of ['checkup', 'steady', 'learn'] as const) {
      expect(decide(cand(), [], settings({ mode }), NOW).decision).toBe('accept');
    }
  });
  it('declines above max difficulty', () => {
    expect(decide(cand({ difficulty: 4 }), [], settings({ maxDifficulty: 3 }), NOW).decision).toBe('decline');
    expect(decide(cand({ difficulty: 3 }), [], settings({ maxDifficulty: 3 }), NOW).decision).toBe('accept');
  });
  it('declines avoided concepts, ignoring case/space/underscore', () => {
    const s = settings({ avoidConcepts: ['Dynamic Programming'] });
    expect(decide(cand({ concepts: ['dynamic_programming'] }), [], s, NOW).decision).toBe('decline');
    expect(decide(cand({ concepts: ['dynamic-programming'] }), [], s, NOW).decision).toBe('decline');
  });
  it('avoid beats focus', () => {
    const s = settings({ focusConcepts: ['regex'], avoidConcepts: ['regex'] });
    expect(decide(cand({ concepts: ['regex'] }), [], s, NOW).decision).toBe('decline');
  });
  it('checkup prefers difficulty >= 3 unless focus matches', () => {
    const s = settings({ mode: 'checkup', focusConcepts: ['Parsing'] });
    expect(decide(cand({ difficulty: 2, concepts: ['sorting'] }), [], s, NOW).decision).toBe('decline');
    expect(decide(cand({ difficulty: 2, concepts: ['parsing'] }), [], s, NOW).decision).toBe('accept');
    expect(decide(cand({ difficulty: 3 }), [], s, NOW).decision).toBe('accept');
  });
  it('rate limits steady mode at 60 minutes with eta in reason', () => {
    const h = [entry(37 * MIN)];
    const r = decide(cand(), h, settings(), NOW);
    expect(r.decision).toBe('decline');
    expect(r.reason).toContain('~23m');
    expect(decide(cand(), [entry(60 * MIN)], settings(), NOW).decision).toBe('accept');
  });
  it('uses the newest offered entry and ignores non-offered ones', () => {
    const h = [entry(2 * 60 * MIN), entry(5 * MIN, { offered: false, status: 'declined_by_policy' })];
    expect(decide(cand(), h, settings(), NOW).decision).toBe('accept');
  });
  it('counts history order independent of array order', () => {
    const h = [entry(5 * MIN), entry(5 * 60 * MIN)];
    expect(decide(cand(), h, settings(), NOW).decision).toBe('decline');
  });
  it('checkup interval is 24h, learn is 2m', () => {
    expect(MODE_MIN_INTERVAL_MS.checkup).toBe(24 * 60 * MIN);
    expect(decide(cand(), [entry(23 * 60 * MIN)], settings({ mode: 'checkup' }), NOW).decision).toBe('decline');
    expect(decide(cand(), [entry(25 * 60 * MIN)], settings({ mode: 'checkup' }), NOW).decision).toBe('accept');
    expect(decide(cand(), [entry(1 * MIN)], settings({ mode: 'learn' }), NOW).decision).toBe('decline');
    expect(decide(cand(), [entry(3 * MIN)], settings({ mode: 'learn' }), NOW).decision).toBe('accept');
  });
  it('focus match halves the steady interval', () => {
    const s = settings({ focusConcepts: ['parsing'] });
    expect(decide(cand(), [entry(35 * MIN)], s, NOW).decision).toBe('accept');
    expect(decide(cand({ concepts: ['other'] }), [entry(35 * MIN)], s, NOW).decision).toBe('decline');
  });
  it('doubles the interval after three ignored offers', () => {
    const ignored = [entry(300 * MIN, { status: 'declined' }), entry(200 * MIN, { status: 'declined' }), entry(90 * MIN, { status: 'declined' })];
    expect(decide(cand(), ignored, settings(), NOW).decision).toBe('decline');
    const mixed = [entry(300 * MIN, { status: 'declined' }), entry(200 * MIN), entry(90 * MIN, { status: 'declined' })];
    expect(decide(cand(), mixed, settings(), NOW).decision).toBe('accept');
    const older = [entry(300 * MIN, { status: 'declined' }), entry(200 * MIN, { status: 'declined' }), entry(130 * MIN, { status: 'declined' })];
    expect(decide(cand(), older, settings(), NOW).decision).toBe('accept');
  });
  it('ignores an offer dated in the future (clock moved backwards) instead of blocking (regression)', () => {
    // Without the guard, an entry 3 days ahead blocked checkup mode for 3 days + 24h.
    expect(decide(cand(), [entry(-3 * 24 * 60 * MIN)], settings({ mode: 'checkup' }), NOW).decision).toBe('accept');
    expect(decide(cand(), [entry(-90 * MIN)], settings(), NOW).decision).toBe('accept');
  });
  it('is deterministic and does not mutate history', () => {
    const h = [entry(10 * MIN), entry(100 * MIN)];
    const copy = JSON.stringify(h);
    expect(decide(cand(), h, settings(), NOW)).toEqual(decide(cand(), h, settings(), NOW));
    expect(JSON.stringify(h)).toBe(copy);
  });
});
