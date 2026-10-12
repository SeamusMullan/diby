/**
 * MODULE languages — TypeScript/JavaScript adapter: vitest with JUnit reporting. Pure (no vscode).
 * Other runners (jest, node --test, ...) still run, with exit-code results only.
 */
import type {
  InstrumentedCommand,
  LanguageAdapter,
  LineRange,
  RawTestOutput,
  StubValidation,
  TestCaseResult,
  TestDiagnostic,
  TestRunResult,
} from '../types';
import { exitCodeResult, junitResult } from './generic';

const VITEST_RE = /\bvitest\b/;
/** Shell operators: appending flags would only reach the last command, so leave such commands alone. */
const SHELL_CHAIN_RE = /&&|\|\||[;|]/;
/** The agent already chose reporters or an output file. */
const OWN_REPORTING_RE = /--reporter\b|--outputFile\b/;
/** vitest stack frame: ` ❯ test/core/x.test.ts:22:5` or ` ❯ fnName src/core/x.ts:9:11`. */
const FRAME_RE = /❯\s+(?:\S+\s+)?([^\s:]+\.[cm]?[jt]sx?):(\d+):(\d+)/;

function quote(p: string): string {
  return `"${p.replace(/(["\\$`])/g, process.platform === 'win32' ? '$1' : '\\$1')}"`;
}

function validateStub(text: string, range: LineRange): StubValidation {
  const lines = text.split(/\r?\n/);
  if (range.startLine < 1 || range.endLine < range.startLine || range.startLine > lines.length) {
    return { ok: false, problems: [`Range ${range.startLine}-${range.endLine} is outside the file (${lines.length} lines).`] };
  }
  const slice = lines.slice(range.startLine - 1, range.endLine).join('\n');
  return /DIBY/.test(slice)
    ? { ok: true, problems: [] }
    : { ok: false, problems: ['The range does not contain a stub mentioning `DIBY` (e.g. `throw new Error("DIBY: name")`).'] };
}

function instrument(cmd: string, tmpDir: string): InstrumentedCommand {
  if (!VITEST_RE.test(cmd) || SHELL_CHAIN_RE.test(cmd) || OWN_REPORTING_RE.test(cmd)) return { cmd };
  const reportPath = `${tmpDir.replace(/[\\/]+$/, '')}/report.xml`;
  return {
    cmd: `${cmd.trimEnd()} --reporter=default --reporter=junit --outputFile.junit=${quote(reportPath)}`,
    reportPath,
  };
}

/** vitest puts the test file in `classname`; keep it as `file` so the panel shows just `suite > test`. */
function mapCase(c: TestCaseResult): TestCaseResult {
  if (!c.classname) return c;
  const { classname, ...rest } = c;
  return { ...rest, file: rest.file ?? classname };
}

/** First and last stack frame of each failure: usually the implementation line and the test line. */
function diagnosticsFor(cases: readonly TestCaseResult[]): TestDiagnostic[] {
  const out: TestDiagnostic[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if ((c.status !== 'failed' && c.status !== 'error') || !c.details) continue;
    const frames = c.details
      .split('\n')
      .map((l) => FRAME_RE.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ file: m[1] as string, line: Number(m[2]), column: Number(m[3]) }));
    const picks = frames.length > 1 ? [frames[0], frames[frames.length - 1]] : frames;
    for (const f of picks) {
      if (!f) continue;
      const key = `${f.file}:${f.line}:${c.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...f, message: `${c.name}: ${c.message ?? 'failed'}`, severity: 'error' });
    }
  }
  return out;
}

function parseResults(raw: RawTestOutput): TestRunResult {
  return junitResult(raw, { mapCase, diagnostics: diagnosticsFor }) ?? exitCodeResult(raw);
}

/** TypeScript/JavaScript adapter (id `typescript`): per-test results when the command runs vitest. */
export function createTypeScriptAdapter(): LanguageAdapter {
  return {
    id: 'typescript',
    displayName: 'TypeScript / JavaScript (vitest)',
    aliases: ['ts', 'tsx', 'typescriptreact', 'javascript', 'js', 'jsx', 'javascriptreact'],
    validateStub,
    instrumentTestCommand: (cmd, tmpDir) => instrument(cmd, tmpDir),
    parseResults,
  };
}
