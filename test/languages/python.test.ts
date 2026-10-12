import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPythonAdapter } from '../../src/languages/python';
import { createLanguageRegistry } from '../../src/languages';
import type { RawTestOutput } from '../../src/types';

const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');
const py = createPythonAdapter();
const ctx = { workspaceFolder: '/w', cwd: '/w' };

const SRC = `import re

@cache
def parse_duration(
    text: str,
) -> int:
    """Parse."""
    raise NotImplementedError("DIBY: parse")


def other():
    return 1
`;

describe('python validateStub', () => {
  it('accepts a DIBY stub and rejects others', () => {
    expect(py.validateStub(SRC, { startLine: 3, endLine: 8 }).ok).toBe(true);
    const bad = py.validateStub(SRC, { startLine: 12, endLine: 13 });
    expect(bad.ok).toBe(false);
    expect(bad.problems.length).toBe(2);
    expect(py.validateStub(SRC, { startLine: 50, endLine: 60 }).ok).toBe(false);
  });
});

describe('python locateSymbol', () => {
  it('includes decorators and multi-line signature, stops before next def', () => {
    expect(py.locateSymbol?.(SRC, 'parse_duration', { startLine: 1, endLine: 2 })).toEqual({ startLine: 3, endLine: 8 });
  });
  it('picks the nearest of duplicates and handles Class.method', () => {
    const t = `class A:\n    def f(self):\n        return 1\n\nclass B:\n    def f(self):\n        x = 1\n        return x\n\ny = 2\n`;
    expect(py.locateSymbol?.(t, 'B.f', { startLine: 6, endLine: 8 })).toEqual({ startLine: 6, endLine: 8 });
    expect(py.locateSymbol?.(t, 'A.f', { startLine: 1, endLine: 1 })).toEqual({ startLine: 2, endLine: 3 });
    expect(py.locateSymbol?.(t, 'nope', { startLine: 1, endLine: 1 })).toBeUndefined();
  });
});

describe('python instrumentTestCommand', () => {
  it.each(['pytest tests -q', 'python -m pytest', 'uv run pytest', 'poetry run pytest -x'])('instruments %s', (cmd) => {
    const r = py.instrumentTestCommand(cmd, '/tmp/d', ctx);
    expect(r.reportPath).toBe('/tmp/d/report.xml');
    expect(r.cmd).toBe(cmd);
    expect(r.env?.['PYTEST_ADDOPTS']).toContain('--junitxml="/tmp/d/report.xml"');
    expect(r.env?.['PYTEST_ADDOPTS']).toContain('junit_family=xunit1');
  });
  it('leaves non-pytest commands and existing --junitxml alone', () => {
    expect(py.instrumentTestCommand('python -m unittest', '/t', ctx)).toEqual({ cmd: 'python -m unittest' });
    expect(py.instrumentTestCommand('pytest --junitxml=x.xml', '/t', ctx).reportPath).toBeUndefined();
  });
  it('rewrites bare leading python/pytest with resolved interpreter only', () => {
    const c = { ...ctx, interpreter: '/venv/bin/python' };
    expect(py.instrumentTestCommand('pytest -q', '/t', c).cmd).toBe('"/venv/bin/python" -m pytest -q');
    expect(py.instrumentTestCommand('python3 -m pytest', '/t', c).cmd).toBe('"/venv/bin/python" -m pytest');
    expect(py.instrumentTestCommand('uv run pytest', '/t', c).cmd).toBe('uv run pytest');
  });
});

describe('python parseResults', () => {
  const raw = (over: Partial<RawTestOutput>): RawTestOutput => ({
    command: 'pytest', cwd: '/w', stdout: 'out', stderr: '', exitCode: 1, timedOut: false, startedAt: 1, durationMs: 5, ...over,
  });
  it('builds cases, counts and diagnostics from a failing report', () => {
    const r = py.parseResults(raw({ reportXml: fx('pytest-xunit1.xml') }));
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ passed: 2, failed: 2, errors: 1, skipped: 1, total: 6 });
    expect(r.diagnostics.some((d) => d.file === 'test_x.py' && d.line === 7)).toBe(true);
  });
  it('is ok for an all-pass report', () => {
    const r = py.parseResults(raw({ exitCode: 0, reportXml: fx('pytest-allpass.xml') }));
    expect(r.ok).toBe(true);
    expect(r.total).toBe(1);
  });
  it('falls back to exit code without a report or with a bad one', () => {
    expect(py.parseResults(raw({ exitCode: 2 }))).toMatchObject({ ok: false, cases: [] });
    expect(py.parseResults(raw({ exitCode: 0, reportXml: '<bad' })).ok).toBe(true);
  });
  it('is not ok when timed out or zero tests ran', () => {
    expect(py.parseResults(raw({ exitCode: 0, timedOut: true, reportXml: fx('pytest-allpass.xml') })).ok).toBe(false);
    expect(py.parseResults(raw({ exitCode: 0, reportXml: '<testsuites/>' })).ok).toBe(false);
  });
});

describe('registry', () => {
  it('resolves ids, aliases (case-insensitive) and falls back to generic', () => {
    const reg = createLanguageRegistry();
    expect(reg.get('Python').id).toBe('python');
    expect(reg.get('py').id).toBe('python');
    expect(reg.get('cobol').id).toBe('generic');
    expect(reg.has('python3')).toBe(true);
    expect(reg.has('cobol')).toBe(false);
    expect(reg.list().map((a) => a.id)).toEqual(['python', 'typescript', 'generic']);
  });
  it('passes the interpreter resolver through', async () => {
    const reg = createLanguageRegistry({ python: { resolveInterpreter: async () => '/x/python' } });
    expect(await reg.get('python').resolveInterpreter?.('/w')).toBe('/x/python');
  });
});

describe('python plugin autoload', () => {
  const raw = (over: Partial<RawTestOutput>): RawTestOutput => ({
    command: 'pytest', cwd: '/w', stdout: '', stderr: '', exitCode: 1, timedOut: false, startedAt: 1, durationMs: 5, ...over,
  });

  it('sets PYTEST_DISABLE_PLUGIN_AUTOLOAD only when enabled', () => {
    const on = createPythonAdapter({ disablePluginAutoload: () => true });
    expect(on.instrumentTestCommand('pytest -q', '/t', ctx).env?.['PYTEST_DISABLE_PLUGIN_AUTOLOAD']).toBe('1');
    expect(on.instrumentTestCommand('pytest --junitxml=x.xml', '/t', ctx).env).toEqual({ PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1' });
    expect(on.instrumentTestCommand('python -m unittest', '/t', ctx).env).toBeUndefined();
    expect(py.instrumentTestCommand('pytest -q', '/t', ctx).env?.['PYTEST_DISABLE_PLUGIN_AUTOLOAD']).toBeUndefined();
  });

  it('prepends a hint when pytest crashes loading an entry-point plugin', () => {
    const crash = 'File ".../pluggy/_manager.py", in load_setuptools_entrypoints\nModuleNotFoundError: No module named osrf_pycommon';
    const r = py.parseResults(raw({ stderr: crash }));
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/^\[Diby\] pytest crashed while auto-loading/);
    expect(r.stderr).toContain('osrf_pycommon');
    expect(py.parseResults(raw({ stderr: 'AssertionError' })).stderr).toBe('AssertionError');
  });
});
