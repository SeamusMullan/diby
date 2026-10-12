import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJUnitXml, summarizeCases } from '../../src/testing/junit';

const fx = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8');

describe('parseJUnitXml', () => {
  it('parses pytest xunit1 output with all statuses', () => {
    const cases = parseJUnitXml(fx('pytest-xunit1.xml'));
    expect(cases).toHaveLength(6);
    const by = Object.fromEntries(cases.map((c) => [c.name, c]));
    expect(by['test_ok']).toMatchObject({ status: 'passed', classname: 'test_x', file: 'test_x.py', line: 2 });
    expect(by['test_fail']).toMatchObject({ status: 'failed', message: 'assert (1 + 1) == 3' });
    expect(by['test_fail']?.details).toContain('test_x.py:7: AssertionError');
    expect(by['test_err']?.status).toBe('error');
    expect(by['test_err']?.message).toContain("fixture 'nofixture' not found");
    expect(by['test_skip']).toMatchObject({ status: 'skipped', message: 'not now' });
    expect(by['test_param[2]']?.status).toBe('failed');
    expect(summarizeCases(cases)).toEqual({ passed: 2, failed: 2, errors: 1, skipped: 1, total: 6 });
  });

  it('parses xunit2 output (no file/line attrs required)', () => {
    const cases = parseJUnitXml(fx('pytest-xunit2.xml'));
    expect(cases).toHaveLength(6);
    expect(summarizeCases(cases).failed).toBe(2);
  });

  it('handles a single testcase (non-array nodes)', () => {
    const cases = parseJUnitXml(fx('pytest-allpass.xml'));
    expect(cases).toHaveLength(1);
    expect(cases[0]?.status).toBe('passed');
  });

  it('handles bare testsuite root, nested suites, and empty skipped/failure tags', () => {
    const xml = `<testsuite name="a"><testsuite name="b"><testcase name="x" classname="C" time="1.5"><skipped/></testcase></testsuite>
      <testcase name="y"><failure/></testcase></testsuite>`;
    const cases = parseJUnitXml(xml);
    expect(cases.map((c) => c.status).sort()).toEqual(['failed', 'skipped']);
    expect(cases.find((c) => c.name === 'x')?.durationMs).toBe(1500);
  });

  it('returns [] for an empty report and throws on malformed XML', () => {
    expect(parseJUnitXml('<testsuites/>')).toEqual([]);
    expect(() => parseJUnitXml('<testsuite><testcase></testsuite>')).toThrow(/Malformed/);
  });
});
