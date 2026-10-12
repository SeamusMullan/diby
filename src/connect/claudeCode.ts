/**
 * MODULE connect — Claude Code: merge the Diby server into the project `.mcp.json`.
 */
import * as path from 'node:path';
import { MCP_SERVER_NAME } from '../constants';
import { readIfExists, writeIfChanged } from './fsutil';
import type { ConnectResult } from './types';

/**
 * Returns `existing` with `mcpServers.diby` set to run the shim under node. Other servers and keys are
 * preserved, as are user-added keys (e.g. `env`) of an existing diby entry. Output is 2-space JSON with a trailing newline.
 * @throws if `existing` is not a valid JSON object (we never overwrite a file we cannot parse).
 */
export function mergeMcpJson(existing: string | undefined, shimPath: string): string {
  let root: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (err) {
      throw new Error(`.mcp.json is not valid JSON (${(err as Error).message}); fix it and retry.`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('.mcp.json must contain a JSON object at the top level.');
    }
    root = parsed as Record<string, unknown>;
  }
  const servers = root.mcpServers;
  if (servers !== undefined && (typeof servers !== 'object' || servers === null || Array.isArray(servers))) {
    throw new Error('.mcp.json: "mcpServers" must be an object.');
  }
  const existingServers = (servers as Record<string, unknown> | undefined) ?? {};
  // Keep keys the user added to an existing diby entry (e.g. `env`); drop only ones that would contradict
  // a stdio server (`url`, `headers`, a non-stdio `type`).
  const prev = existingServers[MCP_SERVER_NAME];
  const keep: Record<string, unknown> = {};
  if (typeof prev === 'object' && prev !== null && !Array.isArray(prev)) {
    for (const [k, v] of Object.entries(prev)) {
      if (k === 'command' || k === 'args' || k === 'url' || k === 'headers') continue;
      if (k === 'type' && v !== 'stdio') continue;
      keep[k] = v;
    }
  }
  const merged = {
    ...root,
    mcpServers: {
      ...existingServers,
      [MCP_SERVER_NAME]: { ...keep, command: 'node', args: [shimPath] },
    },
  };
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/** Merges the Diby server into `<workspaceFolder>/.mcp.json`. */
export async function writeClaudeCodeConfig(workspaceFolder: string, shimPath: string): Promise<ConnectResult> {
  const file = path.join(workspaceFolder, '.mcp.json');
  const existing = await readIfExists(file);
  const next = mergeMcpJson(existing, shimPath);
  const changed = await writeIfChanged(file, existing, next);
  return {
    target: 'claude-code',
    path: file,
    changed,
    message: changed ? 'Added Diby to .mcp.json' : '.mcp.json already configured',
  };
}
