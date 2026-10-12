/**
 * Pure helpers for line ranges. PURE (no vscode). Ranges are 1-based and inclusive.
 */
import type { LineRange } from '../types';

/** A text edit as VS Code reports it, with 0-based lines. */
export interface LineChange {
  /** 0-based first line of the replaced range. */
  startLine: number;
  /** 0-based last line of the replaced range. */
  endLine: number;
  /** Replacement text. */
  text: string;
  /**
   * 0-based character where the replaced range ends. When it is 0, the edit stops *before* the content
   * of `endLine` (e.g. inserting lines at column 0 of the function's first line), so it is an edit above.
   */
  endCharacter?: number;
}

/** Number of line breaks in `text` (\r\n, \n or \r). */
export function countNewlines(text: string): number {
  return (text.match(/\r\n|\n|\r/g) ?? []).length;
}

/** Shift a tracked range after one edit. Edits fully before move it; edits inside grow/shrink it. */
export function shiftRange(range: LineRange, change: LineChange): LineRange {
  const s = change.startLine + 1;
  const e = change.endLine + 1;
  const delta = countNewlines(change.text) - (e - s);
  const { startLine: a, endLine: b } = range;
  // An edit ending at column 0 of the first line leaves that line's content intact: it is "above".
  if (e < a || (e === a && change.endCharacter === 0)) return { startLine: a + delta, endLine: b + delta };
  if (s > b) return range;
  const startLine = Math.min(a, s);
  const endLine = e <= b ? b + delta : s + countNewlines(change.text);
  return { startLine, endLine: Math.max(startLine, endLine) };
}

/** Apply several edits from one change event (VS Code reports them against the pre-edit text; apply bottom-up). */
export function shiftRangeAll(range: LineRange, changes: readonly LineChange[]): LineRange {
  const ordered = [...changes].sort((x, y) => y.startLine - x.startLine);
  return ordered.reduce(shiftRange, range);
}

/** Clamp a range to `[1, lineCount]`. */
export function clampRange(range: LineRange, lineCount: number): LineRange {
  const startLine = Math.min(Math.max(1, range.startLine), Math.max(1, lineCount));
  const endLine = Math.min(Math.max(startLine, range.endLine), Math.max(1, lineCount));
  return { startLine, endLine };
}

/** Extract the lines of `range` from `text` verbatim (original line endings kept, final one dropped). */
export function extractRange(text: string, range: LineRange): { code: string; range: LineRange } {
  const parts = text.split(/(?<=\n)|(?<=\r)(?!\n)/);
  const lineCount = parts.length;
  const r = clampRange(range, lineCount);
  const slice = parts.slice(r.startLine - 1, r.endLine).join('');
  return { code: slice.replace(/(\r\n|\n|\r)$/, ''), range: r };
}
