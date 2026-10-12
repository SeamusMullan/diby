/**
 * MODULE core-ui — plain-text offer wording for notifications and the native modal dialog. Pure: no vscode.
 */
import { basename } from 'node:path';
import type { DelegateRequest } from '../types';

const MAX_SUMMARY_CHARS = 400;

/** One-line question shown in notifications and as the modal title. */
export function offerMessage(req: DelegateRequest): string {
  const concepts = req.concepts.length ? `, ${req.concepts.join(', ')}` : '';
  return `An agent wants you to implement \`${req.symbol}\` (difficulty ${req.difficulty}/5${concepts}). Do it by yourself?`;
}

/** First prose paragraph of a markdown spec, with inline markup stripped, capped in length. */
export function specSummary(spec: string): string {
  const paragraph =
    spec
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !/^(#|\||```|[-*] |\d+\. )/.test(p)) ?? '';
  const plain = paragraph
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return plain.length > MAX_SUMMARY_CHARS ? `${plain.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…` : plain;
}

/** Detail text under the modal title: where the function lives, its signature and what it does. */
export function offerDetail(req: DelegateRequest): string {
  const summary = specSummary(req.spec);
  return [`${req.signature}`, `in ${basename(req.file)}`, summary, 'Accept to see the full spec and tests.']
    .filter(Boolean)
    .join('\n\n');
}
