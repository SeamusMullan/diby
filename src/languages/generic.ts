/**
 * MODULE languages — fallback adapter: exit code only, raw output, no per-test cases.
 */
import type { LanguageAdapter, RawTestOutput, TestCaseResult, TestDiagnostic, TestRunResult } from '../types';
import { MAX_OUTPUT_BYTES } from '../constants';
import { parseJUnitXml, summarizeCases } from '../testing/junit';

/** Cap a string to `max` characters, keeping the tail (failures are usually at the end). */
export function capOutput(s: string, max = MAX_OUTPUT_BYTES): string {
  return s.length > max ? `[... truncated ...]\n${s.slice(s.length - max)}` : s;
}

/** Build a TestRunResult from the process outcome only (no cases). */
export function exitCodeResult(raw: RawTestOutput): TestRunResult {
  const ok = raw.exitCode === 0 && !raw.timedOut;
  return {
    ok,
    command: raw.command,
    exitCode: raw.exitCode,
    timedOut: raw.timedOut,
    startedAt: raw.startedAt,
    durationMs: raw.durationMs,
    cases: [],
    passed: 0,
    failed: 0,
    errors: 0,
    skipped: 0,
    total: 0,
    stdout: capOutput(raw.stdout),
    stderr: capOutput(raw.stderr),
    diagnostics: [],
  };
}

/**
 * Build a TestRunResult from `raw.reportXml` (JUnit). Undefined when there is no report or it is
 * malformed, so callers can fall back to `exitCodeResult`. `ok` also requires at least one case.
 */
export function junitResult(
  raw: RawTestOutput,
  options: {
    diagnostics?: (cases: readonly TestCaseResult[]) => TestDiagnostic[];
    mapCase?: (c: TestCaseResult) => TestCaseResult;
  } = {},
): TestRunResult | undefined {
  if (!raw.reportXml) return undefined;
  let cases: TestCaseResult[];
  try {
    cases = parseJUnitXml(raw.reportXml);
  } catch {
    return undefined;
  }
  if (options.mapCase) cases = cases.map(options.mapCase);
  const counts = summarizeCases(cases);
  const ok = raw.exitCode === 0 && !raw.timedOut && counts.failed === 0 && counts.errors === 0 && counts.total > 0;
  return {
    ...exitCodeResult(raw),
    ok,
    cases,
    ...counts,
    diagnostics: options.diagnostics?.(cases) ?? [],
  };
}

/** Adapter for any language without a dedicated implementation: pass/fail by exit code. */
export function createGenericAdapter(): LanguageAdapter {
  return {
    id: 'generic',
    displayName: 'Generic (exit code)',
    aliases: [],
    validateStub: () => ({ ok: true, problems: [] }),
    instrumentTestCommand: (cmd) => ({ cmd }),
    parseResults: exitCodeResult,
  };
}
