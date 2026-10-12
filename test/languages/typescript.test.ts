import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createLanguageRegistry } from '../../src/languages';
import { createTypeScriptAdapter } from '../../src/languages/typescript';
import type { RawTestOutput } from '../../src/types';

const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');
const ts = createTypeScriptAdapter();
const ctx = { workspaceFolder: '/ws', cwd: '/ws' };
const raw = (over: Partial<RawTestOutput> = {}): RawTestOutput => ({
  command: 'npx vitest run t.test.ts', cwd: '/ws', stdout: 'out', stderr: '', exitCode: 1, timedOut: false,
  startedAt: 0, durationMs: 10, ...over,
});

describe('typescript adapter', () => {
  it('is registered for TypeScript and JavaScript language ids', () => {
    const registry = createLanguageRegistry();
    for (const id of ['typescript', 'TS', 'javascript', 'typescriptreact']) expect(registry.get(id).id).toBe('typescript');
  });

  it('validates that the range holds a DIBY stub', () => {
    const text = 'export function f(): number {\n  throw new Error("DIBY: f");\n}\n';
    expect(ts.validateStub(text, { startLine: 1, endLine: 3 }).ok).toBe(true);
    expect(ts.validateStub('export function f() {\n  return 1;\n}\n', { startLine: 1, endLine: 3 }).ok).toBe(false);
    expect(ts.validateStub(text, { startLine: 9, endLine: 10 }).problems[0]).toContain('outside the file');
  });

  it('adds a JUnit reporter to plain vitest commands', () => {
    const out = ts.instrumentTestCommand('npx vitest run test/a.test.ts ', '/tmp/x/', ctx);
    expect(out.reportPath).toBe('/tmp/x/report.xml');
    expect(out.cmd).toBe('npx vitest run test/a.test.ts --reporter=default --reporter=junit --outputFile.junit="/tmp/x/report.xml"');
  });

  it('leaves other runners, chained commands and custom reporters alone', () => {
    for (const cmd of ['npx jest a.test.ts', 'npm run build && npx vitest run a', 'npx vitest run --reporter=dot', 'node --test']) {
      expect(ts.instrumentTestCommand(cmd, '/tmp/x', ctx)).toEqual({ cmd });
    }
  });

  it('parses vitest JUnit into cases, counts and diagnostics', () => {
    const r = ts.parseResults(raw({ reportXml: fx('vitest-junit.xml') }));
    expect(r).toMatchObject({ ok: false, total: 4, passed: 1, failed: 2, skipped: 1, errors: 0 });
    expect(r.cases.map((c) => [c.name, c.status])).toEqual([
      ['grp > passes', 'passed'],
      ['grp > fails', 'failed'],
      ['grp > skipped', 'skipped'],
      ['throws', 'failed'],
    ]);
    expect(r.cases[1]).toMatchObject({ file: 'test/core/demo.test.ts', message: 'expected [ 1, 2 ] to deeply equal [ 2, 1 ]' });
    expect(r.cases[1]?.classname).toBeUndefined();
    expect(r.cases[1]?.details).toContain('- Expected');
    expect(r.diagnostics).toEqual([
      { file: 'test/core/demo.test.ts', line: 4, column: 36, message: 'grp > fails: expected [ 1, 2 ] to deeply equal [ 2, 1 ]', severity: 'error' },
      { file: 'test/core/demo.test.ts', line: 7, column: 28, message: 'throws: boom', severity: 'error' },
    ]);
  });

  it('reports the implementation frame as well as the test frame', () => {
    const xml = `<testsuites><testsuite name="t"><testcase classname="t.test.ts" name="x">
<failure message="bad" type="TypeError">TypeError: bad
 ❯ weakestConcepts src/core/stats.ts:96:11
 ❯ t.test.ts:12:5</failure></testcase></testsuite></testsuites>`;
    expect(ts.parseResults(raw({ reportXml: xml })).diagnostics.map((d) => `${d.file}:${d.line}`)).toEqual([
      'src/core/stats.ts:96',
      't.test.ts:12',
    ]);
  });

  it('passes only when the exit code is 0 and every case passed', () => {
    const xml = '<testsuites><testsuite name="t"><testcase classname="t" name="a"/></testsuite></testsuites>';
    expect(ts.parseResults(raw({ exitCode: 0, reportXml: xml })).ok).toBe(true);
    expect(ts.parseResults(raw({ exitCode: 0, reportXml: '<testsuites/>' })).ok).toBe(false);
  });

  it('falls back to the exit code without a report or with a malformed one', () => {
    expect(ts.parseResults(raw({ exitCode: 0 }))).toMatchObject({ ok: true, total: 0, cases: [] });
    expect(ts.parseResults(raw({ exitCode: 1, reportXml: '<oops' }))).toMatchObject({ ok: false, total: 0 });
  });
});
