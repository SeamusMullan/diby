/**
 * Zod schemas for the agent-facing tool inputs. Single source of truth for:
 * - bridge request validation (src/bridge/server.ts), and
 * - MCP tool input schemas + descriptions (src/shim/tools.ts) — the `.describe()` texts
 *   are what agents read, so keep them precise.
 *
 * Owned by the architect. Each schema `satisfies` its TS type in src/types.ts so they cannot drift.
 * No `vscode` import here.
 */
import { z } from 'zod';
import { WAIT_DEFAULT_SEC, WAIT_MAX_SEC } from './constants';
import type {
  CancelRequest,
  DelegateRequest,
  LineRange,
  PreferencesRequest,
  ToolName,
  WaitRequest,
} from './types';

export const LineRangeSchema = z
  .object({
    startLine: z.number().int().min(1).describe('First line of the function (1-based), including decorators/signature.'),
    endLine: z.number().int().min(1).describe('Last line of the stub body (1-based, inclusive).'),
  })
  .refine((r) => r.endLine >= r.startLine, { message: 'endLine must be >= startLine' })
  .describe('1-based inclusive line range of the whole stubbed function.') satisfies z.ZodType<LineRange>;

export const DifficultySchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  .describe('1 = warm-up, 3 = solid exercise, 5 = hard. Be honest; the user filters on this.');

export const DelegateRequestSchema = z.object({
  file: z.string().min(1).describe('Path to the file containing the stub (absolute, or relative to your cwd).'),
  range: LineRangeSchema,
  symbol: z.string().min(1).describe('Function or method name, e.g. "parse_duration" or "Tokenizer.next_token".'),
  signature: z.string().min(1).describe('The exact signature as written in the file, e.g. "def parse_duration(text: str) -> int:".'),
  spec: z
    .string()
    .min(1)
    .describe('Markdown spec for the human: purpose, inputs/outputs, edge cases, 1-3 examples. Do not include the solution.'),
  testCommand: z
    .string()
    .min(1)
    .describe('Shell command that runs ONLY this function\'s tests, e.g. "pytest tests/test_duration.py -q".'),
  testFiles: z.array(z.string().min(1)).min(1).describe('Test files you wrote for this function (absolute or relative to your cwd).'),
  language: z.string().min(1).describe('Language id, e.g. "python". Unknown languages fall back to exit-code-only test runs.'),
  concepts: z
    .array(z.string().min(1))
    .max(10)
    .default([])
    .describe('Concept tags in lowercase kebab-case, e.g. ["parsing", "regex", "recursion"].'),
  difficulty: DifficultySchema,
  cwd: z
    .string()
    .optional()
    .describe('Working directory for testCommand (absolute, or relative to your cwd). Defaults to your cwd.'),
  referenceSolution: z
    .string()
    .optional()
    .describe('Optional reference implementation; shown to the human only after they pass or give up.'),
}) satisfies z.ZodType<DelegateRequest>;

export const WaitRequestSchema = z.object({
  id: z.string().min(1).describe('Challenge id returned by diby_delegate.'),
  timeoutSec: z
    .number()
    .int()
    .min(0)
    .max(WAIT_MAX_SEC)
    .default(WAIT_DEFAULT_SEC)
    .describe(`Seconds to long-poll (0-${WAIT_MAX_SEC}, default ${WAIT_DEFAULT_SEC}). Call again while status is "pending" or "active".`),
}) satisfies z.ZodType<WaitRequest>;

export const CancelRequestSchema = z.object({
  id: z.string().min(1).describe('Challenge id returned by diby_delegate.'),
  reason: z.string().optional().describe('Short reason shown to the human.'),
}) satisfies z.ZodType<CancelRequest>;

export const PreferencesRequestSchema = z.object({}) satisfies z.ZodType<PreferencesRequest>;

/** Bridge tool name -> input schema. */
export const TOOL_INPUT_SCHEMAS = {
  delegate: DelegateRequestSchema,
  wait: WaitRequestSchema,
  cancel: CancelRequestSchema,
  preferences: PreferencesRequestSchema,
} as const satisfies Record<ToolName, z.ZodType>;

/** Agent-facing tool descriptions (used by the MCP shim). */
export const TOOL_DESCRIPTIONS: Readonly<Record<ToolName, string>> = {
  delegate:
    'Hand a self-contained function (5-40 lines, real educational value: parsing, algorithms, transforms, validation; ' +
    'never glue or boilerplate) to the human to implement as a practice exercise. BEFORE calling: write the stub in the file ' +
    '(Python body: raise NotImplementedError("DIBY: <symbol>")) and its tests. Returns status "pending" (then poll diby_wait) ' +
    'or "declined_by_policy" (write the function yourself, now).',
  wait:
    'Long-poll a delegated challenge. Returns when it finishes or after timeoutSec. While status is "pending" or "active", call again ' +
    '(do other work in between if you can). "passed": integrate `code` VERBATIM — do not rewrite, reformat or "improve" it. ' +
    '"declined", "declined_by_policy", "gave_up", "cancelled": implement the function yourself.',
  cancel:
    'Abandon a delegated challenge (e.g. the plan changed). The human is told; you then implement or drop the function yourself.',
  preferences:
    'Get the human\'s Diby preferences (mode, focus/avoid concepts, max difficulty, snoozed/busy). Call once per session before delegating, ' +
    'and only delegate functions that match.',
};
