import { describe, expect, it } from 'vitest';
import type { DelegateRequest } from '../../src/types';
import { offerDetail, offerMessage, specSummary } from '../../src/ui/offerText';

const req = (over: Partial<DelegateRequest> = {}): DelegateRequest => ({
  file: 'src/core/stats.ts',
  range: { startLine: 1, endLine: 3 },
  symbol: 'currentStreak',
  signature: 'export function currentStreak(entries, now, tz): number {',
  spec: '## currentStreak\n\nReturn the **current** practice `streak`.\nSee [docs](https://x).\n\n### Rules\n- one',
  testCommand: 'npx vitest run',
  testFiles: ['t.ts'],
  language: 'typescript',
  concepts: ['dates', 'sets'],
  difficulty: 3,
  ...over,
});

describe('offerText', () => {
  it('offerMessage names the symbol, difficulty and concepts', () => {
    expect(offerMessage(req())).toBe(
      'An agent wants you to implement `currentStreak` (difficulty 3/5, dates, sets). Do it by yourself?',
    );
    expect(offerMessage(req({ concepts: [] }))).toContain('(difficulty 3/5)');
  });

  it('specSummary takes the first prose paragraph and strips inline markup', () => {
    expect(specSummary(req().spec)).toBe('Return the current practice streak. See docs.');
  });

  it('specSummary skips headings, tables, lists and code, and caps the length', () => {
    expect(specSummary('# T\n\n| a |\n\n- x\n\n```\ncode\n```')).toBe('');
    expect(specSummary('x'.repeat(1000))).toHaveLength(400);
  });

  it('offerDetail lists signature, file and summary', () => {
    expect(offerDetail(req())).toBe(
      'export function currentStreak(entries, now, tz): number {\n\nin stats.ts\n\nReturn the current practice streak. See docs.\n\nAccept to see the full spec and tests.',
    );
  });
});
