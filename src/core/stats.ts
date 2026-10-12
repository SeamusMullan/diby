/**
 * MODULE core-ui — practice statistics derived from challenge history. PURE: no vscode, no Date.now().
 */
import type { HistoryEntry } from '../types';
import { normalizeConcept } from './policy';

const DAY_MS = 24 * 60 * 60_000;
/** A concept needs this many attempts before it can be flagged as needing practice. */
const WEAK_MIN_ATTEMPTS = 2;
const WEAK_LIMIT = 3;

export interface ConceptStats {
  concept: string;
  passed: number;
  attempted: number;
}

export interface PracticeStats {
  /** Challenges the human was shown. */
  offered: number;
  passed: number;
  gaveUp: number;
  declined: number;
  /** passed / (passed + gaveUp), or undefined when nothing has finished yet. */
  passRate: number | undefined;
  /** Consecutive local days with at least one passed challenge (see `currentStreak`). */
  streakDays: number;
  /** Per-concept totals over attempted challenges, most passed first. */
  concepts: ConceptStats[];
  /** Concepts with the lowest pass rate (see `weakestConcepts`). */
  needsPractice: ConceptStats[];
}

/** Summarise history. `tzOffsetMinutes` is local time minus UTC (e.g. 60 for UTC+1). */
export function computeStats(entries: readonly HistoryEntry[], now: number, tzOffsetMinutes: number): PracticeStats {
  const offered = entries.filter((e) => e.offered);
  const count = (status: HistoryEntry['status']) => offered.filter((e) => e.status === status).length;
  const passed = count('passed');
  const gaveUp = count('gave_up');
  const finished = passed + gaveUp;

  const byConcept = new Map<string, ConceptStats>();
  for (const e of offered) {
    if (e.status !== 'passed' && e.status !== 'gave_up') continue;
    for (const concept of new Set(e.concepts.map(normalizeConcept))) {
      const s = byConcept.get(concept) ?? { concept, passed: 0, attempted: 0 };
      s.attempted += 1;
      if (e.status === 'passed') s.passed += 1;
      byConcept.set(concept, s);
    }
  }
  const concepts = [...byConcept.values()].sort(
    (a, b) => b.passed - a.passed || b.attempted - a.attempted || a.concept.localeCompare(b.concept),
  );

  return {
    offered: offered.length,
    passed,
    gaveUp,
    declined: count('declined'),
    passRate: finished === 0 ? undefined : passed / finished,
    streakDays: currentStreak(entries, now, tzOffsetMinutes),
    concepts,
    needsPractice: weakestConcepts(concepts, WEAK_MIN_ATTEMPTS, WEAK_LIMIT),
  };
}

/**
 * Number of consecutive local calendar days, ending today (or yesterday), on which the human
 * passed at least one challenge. `tzOffsetMinutes` is local time minus UTC (e.g. 60 for UTC+1).
 */
export function currentStreak(entries: readonly HistoryEntry[], now: number, tzOffsetMinutes: number): number {
  const toDay = (t: number) => Math.floor((t + tzOffsetMinutes * 60_000) / DAY_MS);
  const today = toDay(now);
  const days = new Set(
    entries
      .filter((e) => e.status === 'passed')
      .map((e) => toDay(e.finishedAt ?? e.createdAt))
      .filter((d) => d <= today),
  );
  // A streak that ended yesterday is still alive until today is over.
  let day = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

/**
 * The concepts the human struggles with most: lowest pass rate first, at most `limit` of them.
 * Only concepts with at least `minAttempts` attempts and at least one failure qualify.
 */
export function weakestConcepts(concepts: readonly ConceptStats[], minAttempts: number, limit: number): ConceptStats[] {
  if (limit <= 0) return [];
  const rate = (s: ConceptStats) => s.passed / s.attempted;
  return concepts
    .filter((s) => s.attempted >= minAttempts && s.passed < s.attempted)
    .sort((a, b) => rate(a) - rate(b) || b.attempted - a.attempted || a.concept.localeCompare(b.concept))
    .slice(0, limit);
}
