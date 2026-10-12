import { describe, expect, it } from 'vitest';
import { renderPanelBody, renderPanelHtml } from '../../src/ui/panelHtml';
import type { Challenge, TestRunResult } from '../../src/types';

const run: TestRunResult = {
  ok: false, command: 'pytest', exitCode: 1, timedOut: false, startedAt: 0, durationMs: 12,
  cases: [
    { name: 'test_ok', status: 'passed' },
    { name: 'test_<bad>', classname: 'tests.x', status: 'failed', message: 'assert 1 == 2', details: 'Traceback <b>' },
  ],
  passed: 1, failed: 1, errors: 0, skipped: 0, total: 2, stdout: 'out <x>', stderr: '', diagnostics: [],
};

function challenge(over: Partial<Challenge> = {}): Challenge {
  return {
    id: 'i', status: 'active', testFiles: ['/ws/tests/test_a.py'], range: { startLine: 1, endLine: 3 },
    createdAt: 0, updatedAt: 0, attempts: 1, file: { absPath: '/ws/a.py', workspaceFolder: '/ws' },
    request: {
      file: 'a.py', range: { startLine: 1, endLine: 3 }, symbol: 'f<script>', signature: 'def f(x):',
      spec: 'Do **it**\n<img src=x onerror=alert(1)>', testCommand: 'pytest -q', testFiles: ['tests/test_a.py'],
      language: 'python', concepts: ['parsing'], difficulty: 2, referenceSolution: 'SECRET_SOLUTION',
    },
    ...over,
  };
}

describe('panel html', () => {
  it('escapes all dynamic content', () => {
    const html = renderPanelBody(challenge({ lastRun: run }));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('f&lt;script&gt;');
    expect(html).toContain('test_&lt;bad&gt;');
    expect(html).toContain('1/2 passing');
  });
  it('hides the reference solution until the challenge is over', () => {
    expect(renderPanelBody(challenge())).not.toContain('SECRET_SOLUTION');
    expect(renderPanelBody(challenge({ status: 'passed' }))).toContain('SECRET_SOLUTION');
    expect(renderPanelBody(challenge({ status: 'gave_up' }))).toContain('SECRET_SOLUTION');
    expect(renderPanelBody(challenge({ status: 'cancelled' }))).not.toContain('SECRET_SOLUTION');
  });
  it('disables buttons by state', () => {
    expect(renderPanelBody(challenge())).toMatch(/data-action="runTests">Run Tests/);
    expect(renderPanelBody(challenge({ testsRunning: true }))).toMatch(/data-action="runTests" disabled>Running/);
    expect(renderPanelBody(challenge({ status: 'passed' }))).toMatch(/data-action="giveUp" class="secondary" disabled/);
  });
  it('emits a strict nonce CSP with no remote sources', () => {
    const html = renderPanelHtml(challenge(), 'NONCE', 'vscode-resource:');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-NONCE'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});
