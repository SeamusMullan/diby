/**
 * MODULE languages — Python/pytest adapter. Pure (no vscode); interpreter lookup is injected.
 */
import type {
  InstrumentContext,
  InstrumentedCommand,
  LanguageAdapter,
  LineRange,
  RawTestOutput,
  StubValidation,
  TestCaseResult,
  TestDiagnostic,
  TestRunResult,
} from '../types';
import { parseJUnitXml, summarizeCases } from '../testing/junit';
import { capOutput, exitCodeResult } from './generic';

export interface PythonAdapterDeps {
  /** Returns an absolute interpreter path for the folder (VS Code-backed in production). */
  resolveInterpreter?: (workspaceFolder: string) => Promise<string | undefined>;
  /** Read live from `diby.python.disablePluginAutoload`; sets PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 when true. */
  disablePluginAutoload?: () => boolean;
}

/** pytest crashed while auto-loading a third-party plugin (e.g. ROS packages on PYTHONPATH). */
const PLUGIN_CRASH_RE = /load_setuptools_entrypoints/;

export const PLUGIN_AUTOLOAD_HINT =
  '[Diby] pytest crashed while auto-loading a third-party plugin, before any test ran. ' +
  'This usually means an unrelated package on PYTHONPATH (e.g. a sourced ROS environment) registers a broken pytest plugin. ' +
  'Enable the "diby.python.disablePluginAutoload" setting, or set PYTEST_DISABLE_PLUGIN_AUTOLOAD=1, and run the tests again.';

const STUB_RE = /raise\s+NotImplementedError\(\s*[rRuU]?(['"]{1,3})DIBY/;
const PYTEST_RE = /\bpytest\b/;

/** Quote a path for use inside a POSIX or cmd shell command. */
function quote(p: string): string {
  return `"${p.replace(/(["\\$`])/g, process.platform === 'win32' ? '$1' : '\\$1')}"`;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function lastSegment(symbol: string): string {
  const parts = symbol.split('.');
  return parts[parts.length - 1] ?? symbol;
}

function validateStub(text: string, range: LineRange): StubValidation {
  const lines = text.split(/\r?\n/);
  if (range.startLine < 1 || range.endLine < range.startLine || range.startLine > lines.length) {
    return { ok: false, problems: [`Range ${range.startLine}-${range.endLine} is outside the file (${lines.length} lines).`] };
  }
  const slice = lines.slice(range.startLine - 1, range.endLine).join('\n');
  const problems: string[] = [];
  if (!/^\s*(async\s+)?def\s+\w+/m.test(slice)) problems.push('The range does not contain a `def` line.');
  if (!STUB_RE.test(slice)) problems.push('The range does not contain `raise NotImplementedError("DIBY: ...")`.');
  return { ok: problems.length === 0, problems };
}

/** 0-based index of the line where the def's body starts (after the `:` at paren depth 0). */
function signatureEnd(lines: string[], defIdx: number): number {
  let depth = 0;
  for (let i = defIdx; i < lines.length; i++) {
    const line = (lines[i] ?? '').replace(/#.*$/, '');
    for (const ch of line) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === ':' && depth === 0) return i;
    }
  }
  return defIdx;
}

function locateSymbol(text: string, symbol: string, hint: LineRange): LineRange | undefined {
  const lines = text.split(/\r?\n/);
  const name = lastSegment(symbol);
  const defRe = new RegExp(`^(\\s*)(?:async\\s+)?def\\s+${name.replace(/[^\w]/g, '\\$&')}\\s*\\(`);
  let best = -1;
  let bestDist = Infinity;
  lines.forEach((l, i) => {
    if (defRe.test(l)) {
      const dist = Math.abs(i + 1 - hint.startLine);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
  });
  if (best < 0) return undefined;

  const defIndent = indentOf(lines[best] ?? '');
  let start = best;
  while (start > 0) {
    const prev = lines[start - 1] ?? '';
    if (prev.trim() !== '' && indentOf(prev) === defIndent && prev.trimStart().startsWith('@')) start--;
    else break;
  }
  let last = signatureEnd(lines, best);
  for (let i = last + 1; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (l.trim() === '') continue;
    if (indentOf(l) <= defIndent) break;
    last = i;
  }
  return { startLine: start + 1, endLine: last + 1 };
}

function instrument(
  cmd: string,
  tmpDir: string,
  ctx: InstrumentContext,
  disableAutoload = false,
): InstrumentedCommand {
  let out = cmd;
  const interp = ctx.interpreter;
  if (interp) {
    // Only rewrite a bare leading interpreter/pytest token; leave uv/poetry/etc. alone.
    const m = /^(\s*)(python3?|pytest)(?=\s|$)/.exec(out);
    if (m) {
      const replacement = m[2] === 'pytest' ? `${quote(interp)} -m pytest` : quote(interp);
      out = `${m[1] ?? ''}${replacement}${out.slice(m[0].length)}`;
    }
  }
  if (!PYTEST_RE.test(cmd)) return { cmd: out };
  const autoloadEnv: Record<string, string> = disableAutoload ? { PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1' } : {};
  if (/--junit-?xml\b/.test(cmd)) return disableAutoload ? { cmd: out, env: autoloadEnv } : { cmd: out };

  const reportPath = `${tmpDir.replace(/[\\/]+$/, '')}/report.xml`;
  const extra = `--junitxml=${quote(reportPath)} -o junit_family=xunit1`;
  const existing = process.env['PYTEST_ADDOPTS'];
  return {
    cmd: out,
    reportPath,
    env: { ...autoloadEnv, PYTEST_ADDOPTS: existing ? `${existing} ${extra}` : extra },
  };
}

const TRACE_LINE_RE = /^(.+?\.py):(\d+):\s*(.*)$/;

function diagnosticsFor(cases: readonly TestCaseResult[]): TestDiagnostic[] {
  const out: TestDiagnostic[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if ((c.status !== 'failed' && c.status !== 'error') || !c.details) continue;
    const traceLines: { file: string; line: number; message: string }[] = [];
    for (const raw of c.details.split('\n')) {
      const m = TRACE_LINE_RE.exec(raw.trim());
      if (m) traceLines.push({ file: m[1] as string, line: Number(m[2]), message: (m[3] as string) || 'error' });
    }
    // The last frame is where it blew up; also surface the first so test + implementation lines both show.
    const picks = traceLines.length > 1 ? [traceLines[0], traceLines[traceLines.length - 1]] : traceLines;
    for (const p of picks) {
      if (!p) continue;
      const key = `${p.file}:${p.line}:${c.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ file: p.file, line: p.line, message: `${c.name}: ${c.message ?? p.message}`, severity: 'error' });
    }
  }
  return out;
}

function parseResults(raw: RawTestOutput): TestRunResult {
  const base = exitCodeResult(raw);
  if (!raw.reportXml) {
    if (!base.ok && PLUGIN_CRASH_RE.test(`${raw.stdout}\n${raw.stderr}`)) {
      base.stderr = `${PLUGIN_AUTOLOAD_HINT}\n\n${base.stderr}`;
    }
    return base;
  }
  let cases: TestCaseResult[];
  try {
    cases = parseJUnitXml(raw.reportXml);
  } catch {
    return base;
  }
  const counts = summarizeCases(cases);
  const ok =
    raw.exitCode === 0 && !raw.timedOut && counts.failed === 0 && counts.errors === 0 && counts.total > 0;
  return {
    ...base,
    ok,
    cases,
    ...counts,
    stdout: capOutput(raw.stdout),
    stderr: capOutput(raw.stderr),
    diagnostics: diagnosticsFor(cases),
  };
}

/** Python adapter: pytest with JUnit XML reporting (id `python`, aliases `py`, `python3`). */
export function createPythonAdapter(deps: PythonAdapterDeps = {}): LanguageAdapter {
  const adapter: LanguageAdapter = {
    id: 'python',
    displayName: 'Python (pytest)',
    aliases: ['py', 'python3'],
    validateStub,
    locateSymbol,
    instrumentTestCommand: (cmd, tmpDir, ctx) => instrument(cmd, tmpDir, ctx, deps.disablePluginAutoload?.() ?? false),
    parseResults,
  };
  if (deps.resolveInterpreter) {
    const resolve = deps.resolveInterpreter;
    adapter.resolveInterpreter = (folder) => resolve(folder);
  }
  return adapter;
}
