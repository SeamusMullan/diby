import type { ToolCallContext, ToolHandlers } from '../../src/types';

export interface Recorded {
  tool: string;
  req: unknown;
  ctx: ToolCallContext;
}

/** Fake handlers that record calls. `wait` honours the abort signal. */
export function fakeHandlers(calls: Recorded[] = []): ToolHandlers {
  return {
    async delegate(req, ctx) {
      calls.push({ tool: 'delegate', req, ctx });
      return { id: 'c1', status: 'pending', message: 'ok' };
    },
    async wait(req, ctx) {
      calls.push({ tool: 'wait', req, ctx });
      return { id: req.id, status: 'passed', code: 'x = 1', testsPassed: true } as never;
    },
    async cancel(req, ctx) {
      calls.push({ tool: 'cancel', req, ctx });
      return { id: req.id, status: 'cancelled' } as never;
    },
    async preferences(req, ctx) {
      calls.push({ tool: 'preferences', req, ctx });
      return { mode: 'steady', guidance: 'g' } as never;
    },
  };
}

export const validDelegate = {
  file: 'a.py',
  range: { startLine: 1, endLine: 3 },
  symbol: 'f',
  signature: 'def f():',
  spec: 'do it',
  testCommand: 'pytest',
  testFiles: ['t.py'],
  language: 'python',
  difficulty: 2,
};
