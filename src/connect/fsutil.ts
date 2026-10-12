import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Reads a UTF-8 file, returning undefined when it does not exist. */
export async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** Writes `next` to `file` (creating parent dirs) unless it equals `previous`. Returns whether it wrote. */
export async function writeIfChanged(file: string, previous: string | undefined, next: string): Promise<boolean> {
  if (previous === next) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next, 'utf8');
  return true;
}
