/**
 * MODULE transport — copy the bundled shim to a stable path (~/.diby/bin/mcp-shim.js) so agent
 * configs keep working across extension upgrades. Pure Node (no vscode).
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DIBY_HOME_DIRNAME, SHIM_BIN_SUBDIR, SHIM_FILENAME } from '../constants';

/** Copy `bundledShimPath` to ~/.diby/bin/mcp-shim.js if content differs; returns the stable path. */
export async function installShim(bundledShimPath: string, home: string = os.homedir()): Promise<string> {
  const target = path.join(home, DIBY_HOME_DIRNAME, SHIM_BIN_SUBDIR, SHIM_FILENAME);
  const content = await fs.readFile(bundledShimPath);
  const existing = await fs.readFile(target).catch(() => undefined);
  if (existing && existing.equals(content)) return target;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, content, { mode: 0o755 });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
  return target;
}
