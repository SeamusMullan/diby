/**
 * MODULE core-ui — `diby.quietHours`: a daily local-time window with no offers. PURE: no vscode, no Date.now().
 */

/** A daily window in minutes since local midnight. `end` is exclusive and may be before `start` (wraps midnight). */
export interface QuietHours {
  start: number;
  end: number;
}

const DAY_MINUTES = 24 * 60;

/** Minutes since local midnight for epoch ms `now`. `tzOffsetMinutes` is local time minus UTC. */
export function localMinuteOfDay(now: number, tzOffsetMinutes: number): number {
  const minutes = Math.floor(now / 60_000) + tzOffsetMinutes;
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

/** True if `minute` (0-1439) falls inside the window. */
export function inQuietHours(window: QuietHours, minute: number): boolean {
  return window.start < window.end
    ? minute >= window.start && minute < window.end
    : minute >= window.start || minute < window.end;
}

/** `HH:MM` for minutes since midnight. */
export function formatMinuteOfDay(minute: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/**
 * Parse a `diby.quietHours` value such as `"22:00-07:30"` into minutes since midnight.
 * Returns undefined for anything that is not a valid, non-empty window.
 */
export function parseQuietHours(text: string): QuietHours | undefined {
  const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(text);
  if (!m) return undefined;
  const [h1, m1, h2, m2] = m.slice(1).map(Number) as [number, number, number, number];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return undefined;
  const start = h1 * 60 + m1;
  const end = h2 * 60 + m2;
  return start === end ? undefined : { start, end };
}
