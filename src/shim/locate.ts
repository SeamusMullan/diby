/**
 * MODULE transport — find the running extension's bridge endpoint for an agent's cwd.
 * Pure Node (no vscode).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { endpointFilePath, isPidAlive, listEndpoints, readEndpointFile } from '../bridge/endpointFile';
import type { EndpointInfo } from '../types';

export interface LocateOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  isAlive?: (pid: number) => boolean;
}

/** Directories from `start` up to the filesystem root, deepest first. */
function ancestors(start: string): string[] {
  const out: string[] = [];
  let cur = path.resolve(start);
  for (;;) {
    out.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) return out;
    cur = parent;
  }
}

/**
 * Resolution order: `DIBY_ENDPOINT_FILE`, `DIBY_WORKSPACE`, longest workspace-path prefix of `cwd`
 * (also tried on its realpath), then the newest live endpoint. Stale files (dead pid) are skipped.
 */
export async function locateEndpoint(cwd: string, opts: LocateOptions = {}): Promise<EndpointInfo | undefined> {
  const env = opts.env ?? process.env;
  const alive = opts.isAlive ?? isPidAlive;
  const live = async (info: EndpointInfo | undefined): Promise<EndpointInfo | undefined> =>
    info && alive(info.pid) ? info : undefined;

  if (env.DIBY_ENDPOINT_FILE) {
    const hit = await live(await readEndpointFile(env.DIBY_ENDPOINT_FILE));
    if (hit) return hit;
  }
  if (env.DIBY_WORKSPACE) {
    const hit = await live(await readEndpointFile(endpointFilePath(env.DIBY_WORKSPACE, opts.home)));
    if (hit) return hit;
  }

  const starts = [cwd];
  const real = await fs.realpath(cwd).catch(() => undefined);
  if (real && real !== cwd) starts.push(real);
  for (const start of starts) {
    for (const dir of ancestors(start)) {
      const hit = await live(await readEndpointFile(endpointFilePath(dir, opts.home)));
      if (hit) return hit;
    }
  }

  for (const info of await listEndpoints(opts.home)) {
    if (alive(info.pid)) return info;
  }
  return undefined;
}
