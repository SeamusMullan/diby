/**
 * MODULE connect — AGENTS.md section and CLAUDE.md import.
 */
import * as path from 'node:path';
import { AGENTS_MD_END, AGENTS_MD_START, CLAUDE_MD_IMPORT } from '../constants';
import { readIfExists, writeIfChanged } from './fsutil';
import { buildAgentsSnippet } from './snippet';
import type { ConnectResult } from './types';

/**
 * Puts `snippet` between the diby markers: replaces an existing marked section, or appends one
 * (separated by a blank line). Idempotent.
 */
export function upsertAgentsSection(existing: string | undefined, snippet: string): string {
  const section = `${AGENTS_MD_START}\n${snippet.trim()}\n${AGENTS_MD_END}`;
  const src = existing ?? '';
  // Use the LAST start marker and the first end marker after it. With the first start marker, a dangling
  // start left in the file (end marker deleted by hand) would, on the next run, swallow every line of
  // user content between it and the section we appended.
  const s = src.lastIndexOf(AGENTS_MD_START);
  const e = s >= 0 ? src.indexOf(AGENTS_MD_END, s + AGENTS_MD_START.length) : -1;
  if (s >= 0 && e >= 0) {
    return `${src.slice(0, s)}${section}${src.slice(e + AGENTS_MD_END.length)}`;
  }
  const body = src.replace(/\s+$/, '');
  return body === '' ? `${section}\n` : `${body}\n\n${section}\n`;
}

/** Ensures a line equal to `@AGENTS.md` exists (so Claude Code reads AGENTS.md). Idempotent. */
export function ensureClaudeImport(existing: string | undefined): string {
  if (existing === undefined || existing.trim() === '') return `${CLAUDE_MD_IMPORT}\n`;
  if (existing.split(/\r?\n/).some((l) => l.trim() === CLAUDE_MD_IMPORT)) return existing;
  return `${existing.replace(/\s+$/, '')}\n\n${CLAUDE_MD_IMPORT}\n`;
}

/** Writes the Diby section to AGENTS.md and the import to CLAUDE.md in `workspaceFolder`. */
export async function writeAgentInstructions(workspaceFolder: string): Promise<ConnectResult[]> {
  const agentsPath = path.join(workspaceFolder, 'AGENTS.md');
  const claudePath = path.join(workspaceFolder, 'CLAUDE.md');
  const agents = await readIfExists(agentsPath);
  const claude = await readIfExists(claudePath);
  const agentsChanged = await writeIfChanged(agentsPath, agents, upsertAgentsSection(agents, buildAgentsSnippet()));
  const claudeChanged = await writeIfChanged(claudePath, claude, ensureClaudeImport(claude));
  return [
    {
      target: 'agents-md',
      path: agentsPath,
      changed: agentsChanged,
      message: agentsChanged ? 'Updated Diby section in AGENTS.md' : 'AGENTS.md already up to date',
    },
    {
      target: 'claude-md',
      path: claudePath,
      changed: claudeChanged,
      message: claudeChanged ? 'Added @AGENTS.md to CLAUDE.md' : 'CLAUDE.md already imports AGENTS.md',
    },
  ];
}
