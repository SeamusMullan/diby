/**
 * MODULE core-ui — plain-text rendering of PracticeStats (status bar tooltip, Show Stats command). Pure: no vscode.
 */
import type { PracticeStats } from '../core/stats';

const TOP_CONCEPTS = 5;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line per fact, most important first. */
export function formatStats(stats: PracticeStats): string[] {
  const lines = [
    stats.streakDays > 0
      ? `Streak: ${plural(stats.streakDays, 'day')}`
      : 'Streak: none yet (pass a challenge today to start one)',
  ];
  const finished = stats.passed + stats.gaveUp;
  lines.push(
    stats.passRate === undefined
      ? 'No finished challenges yet'
      : `Passed ${stats.passed} of ${finished} finished (${Math.round(stats.passRate * 100)}%)`,
  );
  lines.push(`Offered ${stats.offered}, declined ${stats.declined}`);
  if (stats.concepts.length > 0) {
    const top = stats.concepts.slice(0, TOP_CONCEPTS).map((c) => `${c.concept} ${c.passed}/${c.attempted}`);
    lines.push(`Top concepts: ${top.join(', ')}`);
  }
  if (stats.needsPractice.length > 0) {
    lines.push(`Needs practice: ${stats.needsPractice.map((c) => `${c.concept} ${c.passed}/${c.attempted}`).join(', ')}`);
  }
  return lines;
}
