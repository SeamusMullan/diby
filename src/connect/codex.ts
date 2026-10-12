/**
 * MODULE connect — Codex: merge `[mcp_servers.diby]` into `~/.codex/config.toml` without touching the rest.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { parse, stringify } from 'smol-toml';
import { CODEX_TOOL_TIMEOUT_SEC, MCP_SERVER_NAME } from '../constants';
import { readIfExists, writeIfChanged } from './fsutil';
import type { ConnectResult } from './types';

const HEADER_RE = /^\s*\[\s*mcp_servers\s*\.\s*(?:"diby"|'diby'|diby)\s*\]\s*(?:#.*)?$/;
const ANY_HEADER_RE = /^\s*\[/;

function buildBlock(shimPath: string, extra: Record<string, unknown> = {}): string {
  return stringify({
    mcp_servers: {
      [MCP_SERVER_NAME]: { ...extra, command: 'node', args: [shimPath], tool_timeout_sec: CODEX_TOOL_TIMEOUT_SEC },
    },
  }).trimEnd();
}

/** Keys the user added inside an existing `[mcp_servers.diby]` table (env, enabled, startup_timeout_sec, ...). */
function userKeys(tableLines: string[]): Record<string, unknown> {
  const parsed = parse(tableLines.join('\n')) as { mcp_servers?: Record<string, Record<string, unknown>> };
  const { command: _c, args: _a, tool_timeout_sec: _t, ...rest } = parsed.mcp_servers?.[MCP_SERVER_NAME] ?? {};
  return rest;
}

/**
 * Returns `existing` with the `[mcp_servers.diby]` table set (replaced in place if present, appended otherwise).
 * Comments and all other content are kept byte-for-byte; user-added keys inside the diby table are kept. The result is validated with a TOML parse.
 * @throws if the existing file is invalid TOML, or defines diby in a form we cannot edit safely (inline table).
 */
export function mergeCodexToml(existing: string | undefined, shimPath: string): string {
  const src = existing ?? '';
  if (src.trim() !== '') {
    try {
      parse(src);
    } catch (err) {
      throw new Error(`Codex config.toml is not valid TOML (${(err as Error).message}); fix it and retry.`);
    }
  }
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const start = lines.findIndex((l) => HEADER_RE.test(l));

  let out: string;
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (ANY_HEADER_RE.test(lines[i] ?? '')) {
        end = i;
        break;
      }
    }
    // Keep blank/comment lines that trail the table attached to whatever follows it.
    let keepFrom = end;
    while (keepFrom > start + 1 && /^\s*(#.*)?$/.test(lines[keepFrom - 1] ?? '')) keepFrom--;
    // Keep keys the user added to the table (e.g. `env`, `enabled`); only ours are overwritten.
    const replacement = buildBlock(shimPath, userKeys(lines.slice(start, keepFrom))).split('\n');
    out = [...lines.slice(0, start), ...replacement, ...lines.slice(keepFrom)].join(eol);
  } else {
    const existingServers = (parse(src || '') as { mcp_servers?: Record<string, unknown> }).mcp_servers;
    if (existingServers && MCP_SERVER_NAME in existingServers) {
      throw new Error(
        'Codex config.toml already defines mcp_servers.diby in a form Diby cannot edit safely (e.g. an inline table). Remove it or convert it to a [mcp_servers.diby] table.',
      );
    }
    const body = src.replace(/\s+$/, '');
    out = (body === '' ? '' : `${body}${eol}${eol}`) + buildBlock(shimPath).split('\n').join(eol);
  }
  if (!out.endsWith('\n')) out += eol;
  parse(out); // sanity check: never emit something that does not parse
  return out;
}

/** Path of Codex's config file: `$CODEX_HOME/config.toml`, else `~/.codex/config.toml`. */
export function codexConfigPath(home: string = os.homedir()): string {
  const codexHome = process.env.CODEX_HOME;
  return path.join(codexHome && codexHome.trim() !== '' ? codexHome : path.join(home, '.codex'), 'config.toml');
}

/** Merges the Diby server into the Codex config file. The caller is responsible for user confirmation. */
export async function writeCodexConfig(shimPath: string, home?: string): Promise<ConnectResult> {
  const file = codexConfigPath(home);
  const existing = await readIfExists(file);
  const next = mergeCodexToml(existing, shimPath);
  const changed = await writeIfChanged(file, existing, next);
  return {
    target: 'codex',
    path: file,
    changed,
    message: changed ? 'Added [mcp_servers.diby] to Codex config' : 'Codex config already configured',
  };
}
