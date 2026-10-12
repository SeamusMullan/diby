/**
 * MODULE transport — ~/.diby/endpoints/<sha1>.json read/write. Pure Node (no vscode).
 * Shared by the bridge side (writer) and the shim (reader).
 */
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DIBY_HOME_DIRNAME, ENDPOINTS_SUBDIR } from '../constants';
import type { EndpointInfo } from '../types';

/** path.resolve, strip trailing separators; lowercase on win32. Both sides MUST hash this. */
export function normalizeWorkspacePath(p: string): string {
  let out = path.resolve(p);
  const root = path.parse(out).root;
  while (out.length > root.length && (out.endsWith('/') || out.endsWith('\\'))) {
    out = out.slice(0, -1);
  }
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

/** sha1 hex of normalizeWorkspacePath(p). */
export function workspaceKey(p: string): string {
  return createHash('sha1').update(normalizeWorkspacePath(p)).digest('hex');
}

/**
 * ~/.diby/endpoints. An explicit `home` always wins; otherwise `$DIBY_ENDPOINT_DIR` (used by tests and
 * unusual setups; must be set identically for the extension host and the shim) overrides the default.
 */
export function endpointsDir(home?: string): string {
  if (home === undefined && process.env.DIBY_ENDPOINT_DIR) return path.resolve(process.env.DIBY_ENDPOINT_DIR);
  return path.join(home ?? os.homedir(), DIBY_HOME_DIRNAME, ENDPOINTS_SUBDIR);
}

/** Path of the endpoint file for a workspace folder. */
export function endpointFilePath(workspace: string, home?: string): string {
  return path.join(endpointsDir(home), `${workspaceKey(workspace)}.json`);
}

/** Atomic write (tmp + rename), mode 0600, creating dirs. Returns the file path. */
export async function writeEndpointFile(info: EndpointInfo, home?: string): Promise<string> {
  const target = endpointFilePath(info.workspace, home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(info, null, 2) + '\n', { mode: 0o600 });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  return target;
}

/** Remove the file for `workspace`, but only if it still belongs to `pid` (when given). */
export async function removeEndpointFile(
  workspace: string,
  opts: { home?: string; pid?: number } = {},
): Promise<void> {
  const target = endpointFilePath(workspace, opts.home);
  if (opts.pid !== undefined) {
    const existing = await readEndpointFile(target);
    if (existing && existing.pid !== opts.pid) return;
  }
  await fs.rm(target, { force: true });
}

/**
 * Re-claim the endpoint file for `info.workspace` when it is missing, unreadable, or owned by a dead
 * process; leave it alone when it is already ours or belongs to another live window. Returns whether it wrote.
 * Needed for two windows on the same folder: the window that wrote last deletes the file when it closes,
 * which would otherwise leave the surviving window unreachable.
 */
export async function ensureEndpointFile(
  info: EndpointInfo,
  opts: { home?: string; isAlive?: (pid: number) => boolean } = {},
): Promise<boolean> {
  const alive = opts.isAlive ?? isPidAlive;
  const existing = await readEndpointFile(endpointFilePath(info.workspace, opts.home));
  if (existing) {
    const ours = existing.pid === info.pid && existing.port === info.port && existing.token === info.token;
    if (ours) return false;
    if (existing.pid !== info.pid && alive(existing.pid)) return false;
  }
  await writeEndpointFile(info, opts.home);
  return true;
}

function isEndpointInfo(v: unknown): v is EndpointInfo {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    typeof o.port === 'number' &&
    Number.isInteger(o.port) &&
    o.port > 0 &&
    o.port < 65536 &&
    typeof o.token === 'string' &&
    o.token.length > 0 &&
    typeof o.pid === 'number' &&
    typeof o.workspace === 'string' &&
    typeof o.writtenAt === 'number'
  );
}

/** Parse + validate one endpoint file; undefined if missing/invalid. */
export async function readEndpointFile(filePath: string): Promise<EndpointInfo | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!isEndpointInfo(parsed)) return undefined;
    return { ...parsed, extensionVersion: typeof parsed.extensionVersion === 'string' ? parsed.extensionVersion : '' };
  } catch {
    return undefined;
  }
}

/** All valid endpoint files, newest `writtenAt` first. */
export async function listEndpoints(home?: string): Promise<EndpointInfo[]> {
  const dir = endpointsDir(home);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const infos = await Promise.all(
    names.filter((n) => n.endsWith('.json')).map((n) => readEndpointFile(path.join(dir, n))),
  );
  return infos.filter((i): i is EndpointInfo => i !== undefined).sort((a, b) => b.writtenAt - a.writtenAt);
}

/** process.kill(pid, 0) liveness check. */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
