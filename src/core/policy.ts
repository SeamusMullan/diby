/**
 * MODULE core-ui — frequency policy. PURE: no vscode, no Date.now(), no I/O.
 */
import type { DibyMode, HistoryEntry, PolicyFn } from '../types';
import { formatMinuteOfDay, inQuietHours, localMinuteOfDay, parseQuietHours } from './quietHours';

/** Minimum gap between *offered* challenges, per mode (ms). `off` never offers. */
export const MODE_MIN_INTERVAL_MS: Readonly<Record<Exclude<DibyMode, 'off'>, number>> = {
  checkup: 24 * 60 * 60_000,
  steady: 60 * 60_000,
  learn: 2 * 60_000,
};

/** Normalise a concept tag: lowercase, spaces/underscores become dashes. */
export function normalizeConcept(concept: string): string {
  return concept.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
}

/** True when the last three offers were all declined by the user (back-off trigger). */
function recentlyIgnored(offered: readonly HistoryEntry[]): boolean {
  const last = offered.slice(-3);
  return last.length === 3 && last.every((e) => e.status === 'declined');
}

/** Decide whether to offer a candidate to the human. */
export const decide: PolicyFn = (candidate, history, settings, now) => {
  const { mode } = settings;
  if (mode === 'off') return { decision: 'decline', reason: 'Diby is switched off (diby.mode = off)' };

  const quiet = settings.quietHours ? parseQuietHours(settings.quietHours) : undefined;
  if (quiet && inQuietHours(quiet, localMinuteOfDay(now, settings.tzOffsetMinutes ?? 0))) {
    return {
      decision: 'decline',
      reason: `quiet hours (${formatMinuteOfDay(quiet.start)}-${formatMinuteOfDay(quiet.end)} local time)`,
    };
  }

  if (candidate.difficulty > settings.maxDifficulty) {
    return {
      decision: 'decline',
      reason: `difficulty ${candidate.difficulty} exceeds the user's maximum of ${settings.maxDifficulty}`,
    };
  }

  const concepts = candidate.concepts.map(normalizeConcept);
  const avoid = new Set(settings.avoidConcepts.map(normalizeConcept));
  const hitAvoid = concepts.find((c) => avoid.has(c));
  if (hitAvoid) return { decision: 'decline', reason: `the user avoids the concept "${hitAvoid}"` };

  const focus = new Set(settings.focusConcepts.map(normalizeConcept));
  const focusMatch = concepts.some((c) => focus.has(c));

  if (mode === 'checkup' && candidate.difficulty < 3 && !focusMatch) {
    return {
      decision: 'decline',
      reason: 'checkup mode only offers difficulty 3+ functions (or ones matching a focus concept)',
    };
  }

  const offered = history.filter((e) => e.offered).sort((a, b) => a.createdAt - b.createdAt);
  const last = offered[offered.length - 1];
  if (last) {
    let interval = MODE_MIN_INTERVAL_MS[mode];
    if (mode === 'steady' && focusMatch) interval /= 2;
    if (recentlyIgnored(offered)) interval *= 2;
    const elapsed = now - last.createdAt;
    // A last offer "in the future" means the clock moved backwards (or history came from a skewed
    // machine). Ignore it rather than blocking offers for however long the skew is.
    if (elapsed >= 0 && elapsed < interval) {
      return {
        decision: 'decline',
        reason: `rate limit in ${mode} mode: next offer in ~${formatDuration(interval - elapsed)}`,
      };
    }
  }

  return {
    decision: 'accept',
    reason: focusMatch ? `${mode} mode: matches a focus concept` : `${mode} mode: within budget`,
  };
};
