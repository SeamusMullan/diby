import { describe, expect, it } from 'vitest';
import { DelegateRequestSchema, WaitRequestSchema } from '../src/schemas';
import { WAIT_DEFAULT_SEC } from '../src/constants';

const valid = {
  file: 'textkit/duration.py',
  range: { startLine: 10, endLine: 14 },
  symbol: 'parse_duration',
  signature: 'def parse_duration(text: str) -> int:',
  spec: 'Parse "1h30m" into seconds.',
  testCommand: 'pytest tests/test_duration.py -q',
  testFiles: ['tests/test_duration.py'],
  language: 'python',
  difficulty: 3,
};

describe('schemas', () => {
  it('accepts a valid delegate request and defaults concepts', () => {
    const parsed = DelegateRequestSchema.parse(valid);
    expect(parsed.concepts).toEqual([]);
  });

  it('rejects inverted ranges and out-of-range difficulty', () => {
    expect(DelegateRequestSchema.safeParse({ ...valid, range: { startLine: 5, endLine: 4 } }).success).toBe(false);
    expect(DelegateRequestSchema.safeParse({ ...valid, difficulty: 6 }).success).toBe(false);
  });

  it('defaults and caps wait timeout', () => {
    expect(WaitRequestSchema.parse({ id: 'x' }).timeoutSec).toBe(WAIT_DEFAULT_SEC);
    expect(WaitRequestSchema.safeParse({ id: 'x', timeoutSec: 46 }).success).toBe(false);
  });
});
