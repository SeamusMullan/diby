import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { runTests } from '../../src/testing/runner';
import { createGenericAdapter } from '../../src/languages/generic';
import { createPythonAdapter } from '../../src/languages/python';

const base = { cwd: process.cwd(), workspaceFolder: process.cwd(), timeoutSec: 20 };

describe('runTests', () => {
  it('passes on exit 0 and captures stdout', async () => {
    const r = await runTests({ ...base, command: 'echo hello', adapter: createGenericAdapter() });
    expect(r).toMatchObject({ ok: true, exitCode: 0, timedOut: false });
    expect(r.stdout).toContain('hello');
  });
  it('fails on non-zero exit without rejecting', async () => {
    const r = await runTests({ ...base, command: 'echo bad >&2; exit 3', adapter: createGenericAdapter() });
    expect(r).toMatchObject({ ok: false, exitCode: 3 });
    expect(r.stderr).toContain('bad');
  });
  it('kills on timeout', async () => {
    const t = Date.now();
    const r = await runTests({ ...base, timeoutSec: 1, command: 'sleep 30', adapter: createGenericAdapter() });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
    expect(Date.now() - t).toBeLessThan(10_000);
  });
  it('kills on abort', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const r = await runTests({ ...base, command: 'sleep 30', adapter: createGenericAdapter(), signal: ac.signal });
    expect(r.ok).toBe(false);
  });
  it('caps huge output', async () => {
    const r = await runTests({ ...base, command: 'head -c 2000000 /dev/zero | tr "\\0" a', adapter: createGenericAdapter() });
    expect(r.stdout.length).toBeLessThan(300_000);
  });
  it('removes the temp dir and reads the adapter report', async () => {
    let dir = '';
    const adapter = {
      ...createGenericAdapter(),
      instrumentTestCommand: (_c: string, tmp: string) => {
        dir = tmp;
        return { cmd: `echo '<testsuite><testcase name="t"/></testsuite>' > "${tmp}/r.xml"`, reportPath: `${tmp}/r.xml` };
      },
      parseResults: (raw: { reportXml?: string; command: string; exitCode: number | null }) =>
        ({ ...createGenericAdapter().parseResults(raw as never), stdout: raw.reportXml ?? 'none' }),
    };
    const r = await runTests({ ...base, command: 'x', adapter });
    expect(r.stdout).toContain('testcase');
    expect(existsSync(dir)).toBe(false);
  });
  it('reports a missing command as failure', async () => {
    const r = await runTests({ ...base, command: 'definitely-not-a-command-xyz', adapter: createGenericAdapter() });
    expect(r.ok).toBe(false);
  });
  it('runs real pytest end-to-end when available', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const d = mkdtempSync(join(tmpdir(), 'diby-e2e-'));
    writeFileSync(join(d, 'test_a.py'), 'def test_a():\n    assert 1 == 2\n\ndef test_b():\n    assert True\n');
    const r = await runTests({
      cwd: d, workspaceFolder: d, timeoutSec: 120,
      command: 'uv run --with pytest pytest -q', adapter: createPythonAdapter(),
      env: { PYTEST_DISABLE_PLUGIN_AUTOLOAD: '1' },
    });
    if (r.total === 0) return; // uv/network unavailable
    expect(r).toMatchObject({ ok: false, passed: 1, failed: 1, total: 2 });
  }, 130_000);
});
