import { describe, expect, it } from 'vitest';
import { clampRange, extractRange, shiftRange, shiftRangeAll } from '../../src/ui/textRange';

const R = { startLine: 5, endLine: 8 };

describe('shiftRange', () => {
  it('shifts when lines are inserted above', () => {
    expect(shiftRange(R, { startLine: 0, endLine: 0, text: 'x\ny\n' })).toEqual({ startLine: 7, endLine: 10 });
  });
  it('shifts up when lines are deleted above', () => {
    expect(shiftRange(R, { startLine: 0, endLine: 2, text: '' })).toEqual({ startLine: 3, endLine: 6 });
  });
  it('ignores edits below', () => {
    expect(shiftRange(R, { startLine: 20, endLine: 20, text: 'a\nb' })).toEqual(R);
  });
  it('grows when typing a newline inside', () => {
    expect(shiftRange(R, { startLine: 6, endLine: 6, text: '\n' })).toEqual({ startLine: 5, endLine: 9 });
  });
  it('grows when pressing enter at the end of the last line', () => {
    expect(shiftRange(R, { startLine: 7, endLine: 7, text: '\n    ' })).toEqual({ startLine: 5, endLine: 9 });
  });
  it('replaces the body (one-line stub body to many lines)', () => {
    expect(shiftRange({ startLine: 1, endLine: 2 }, { startLine: 1, endLine: 1, text: 'a\nb\nc' })).toEqual({ startLine: 1, endLine: 4 });
  });
  it('same-line edits do not change the range', () => {
    expect(shiftRange(R, { startLine: 6, endLine: 6, text: 'abc' })).toEqual(R);
  });
  it('deleting across the range end collapses to the edit', () => {
    expect(shiftRange(R, { startLine: 7, endLine: 12, text: '' })).toEqual({ startLine: 5, endLine: 8 });
  });
  it('lines inserted at column 0 of the first line go above the region (regression)', () => {
    // Cursor at the start of the `def` line (line 5), paste a helper ending in a newline.
    expect(shiftRange(R, { startLine: 4, endLine: 4, endCharacter: 0, text: 'def helper():\n    pass\n\n' })).toEqual({
      startLine: 8,
      endLine: 11,
    });
    // Deleting whole lines that end at column 0 of the first line also just shifts.
    expect(shiftRange(R, { startLine: 2, endLine: 4, endCharacter: 0, text: '' })).toEqual({ startLine: 3, endLine: 6 });
    // Typing on the first line itself (end column > 0) still counts as inside.
    expect(shiftRange(R, { startLine: 4, endLine: 4, endCharacter: 3, text: '\n' })).toEqual({ startLine: 5, endLine: 9 });
  });
  it('applies multiple changes bottom-up', () => {
    const out = shiftRangeAll(R, [
      { startLine: 0, endLine: 0, text: '\n' },
      { startLine: 6, endLine: 6, text: '\n' },
    ]);
    expect(out).toEqual({ startLine: 6, endLine: 10 });
  });
});

describe('extractRange', () => {
  it('extracts lines verbatim', () => {
    const text = 'a\ndef f():\n    return 1\n\nz\n';
    expect(extractRange(text, { startLine: 2, endLine: 3 })).toEqual({
      code: 'def f():\n    return 1',
      range: { startLine: 2, endLine: 3 },
    });
  });
  it('preserves CRLF inside and tabs', () => {
    const text = 'a\r\n\tb\r\n\tc\r\nd';
    expect(extractRange(text, { startLine: 2, endLine: 3 }).code).toBe('\tb\r\n\tc');
  });
  it('clamps out-of-range requests', () => {
    expect(extractRange('a\nb', { startLine: 2, endLine: 99 })).toEqual({ code: 'b', range: { startLine: 2, endLine: 2 } });
    expect(clampRange({ startLine: 0, endLine: 0 }, 3)).toEqual({ startLine: 1, endLine: 1 });
  });
});
