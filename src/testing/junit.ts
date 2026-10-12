/**
 * MODULE languages — JUnit XML parsing (pytest, vitest; Surefire, jest junit later). Pure.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { TestCaseResult } from '../types';

const ARRAY_TAGS = new Set(['testsuite', 'testcase', 'failure', 'error', 'skipped']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type XmlNode = Record<string, unknown>;

function asNode(v: unknown): XmlNode | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as XmlNode) : undefined;
}

function attr(node: XmlNode, name: string): string | undefined {
  const v = node[`@_${name}`];
  return typeof v === 'string' ? v : undefined;
}

function toList(v: unknown): XmlNode[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  // A childless tag like `<skipped/>` parses to '' — keep it as an empty node.
  return arr.map((x) => asNode(x) ?? {});
}

function nodeText(node: XmlNode): string | undefined {
  const t = node['#text'];
  const s = typeof t === 'string' ? t : Array.isArray(t) ? t.join('') : '';
  return s.trim() === '' ? undefined : s.trim();
}

function parseNumber(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function collectCases(node: XmlNode, out: XmlNode[]): void {
  for (const c of toList(node['testcase'])) out.push(c);
  for (const s of toList(node['testsuite'])) collectCases(s, out);
  for (const s of toList(node['testsuites'])) collectCases(s, out);
}

function toResult(tc: XmlNode): TestCaseResult {
  const failure = toList(tc['failure'])[0];
  const error = toList(tc['error'])[0];
  const skipped = toList(tc['skipped'])[0];
  const problem = error ?? failure;

  const result: TestCaseResult = {
    name: attr(tc, 'name') ?? '(unnamed)',
    status: error ? 'error' : failure ? 'failed' : skipped ? 'skipped' : 'passed',
  };
  const classname = attr(tc, 'classname');
  if (classname) result.classname = classname;
  const file = attr(tc, 'file');
  if (file) result.file = file;
  const line = parseNumber(attr(tc, 'line'));
  if (line !== undefined) result.line = line;
  const seconds = parseNumber(attr(tc, 'time'));
  if (seconds !== undefined) result.durationMs = Math.round(seconds * 1000);

  const source = problem ?? skipped;
  if (source) {
    const details = nodeText(source);
    const message = attr(source, 'message') ?? details?.split('\n')[0];
    if (message) result.message = message;
    if (details && problem) result.details = details;
  }
  return result;
}

/** Parse a JUnit XML report (<testsuites>/<testsuite>/<testcase>) into case results. Throws on malformed XML. */
export function parseJUnitXml(xml: string): TestCaseResult[] {
  const valid = XMLValidator.validate(xml);
  if (valid !== true) {
    throw new Error(`Malformed JUnit XML: ${valid.err.msg} (line ${valid.err.line})`);
  }
  const doc = asNode(parser.parse(xml));
  if (!doc) return [];
  const cases: XmlNode[] = [];
  collectCases(doc, cases);
  return cases.map(toResult);
}

/** Count cases by status. */
export function summarizeCases(cases: readonly TestCaseResult[]): {
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  total: number;
} {
  const s = { passed: 0, failed: 0, errors: 0, skipped: 0, total: cases.length };
  for (const c of cases) {
    if (c.status === 'passed') s.passed++;
    else if (c.status === 'failed') s.failed++;
    else if (c.status === 'error') s.errors++;
    else s.skipped++;
  }
  return s;
}
