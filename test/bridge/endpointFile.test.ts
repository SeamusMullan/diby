import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  endpointFilePath,
  ensureEndpointFile,
  isPidAlive,
  listEndpoints,
  normalizeWorkspacePath,
  readEndpointFile,
  removeEndpointFile,
  workspaceKey,
  writeEndpointFile,
} from '../../src/bridge/endpointFile';
import { installShim } from '../../src/bridge/installShim';
import type { EndpointInfo } from '../../src/types';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'diby-home-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const info = (workspace: string, over: Partial<EndpointInfo> = {}): EndpointInfo => ({
  version: 1,
  port: 4321,
  token: 't',
  pid: process.pid,
  workspace,
  writtenAt: 1000,
  extensionVersion: '0.0.1',
  ...over,
});

describe('workspace key', () => {
  it('normalizes trailing separators and hashes stably', () => {
    expect(normalizeWorkspacePath('/a/b/')).toBe('/a/b');
    expect(workspaceKey('/a/b/')).toBe(workspaceKey('/a/b'));
    expect(workspaceKey('/a/b')).toMatch(/^[0-9a-f]{40}$/);
    expect(workspaceKey('/a/b')).not.toBe(workspaceKey('/a/c'));
  });
});

describe('endpoint files', () => {
  it('writes atomically with mode 0600 and reads back', async () => {
    const file = await writeEndpointFile(info('/w/one'), home);
    expect(file).toBe(endpointFilePath('/w/one', home));
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readEndpointFile(file)).toEqual(info('/w/one'));
  });

  it('returns undefined for missing or invalid files', async () => {
    expect(await readEndpointFile(path.join(home, 'nope.json'))).toBeUndefined();
    const bad = path.join(home, 'bad.json');
    await writeFile(bad, '{"version":1}');
    expect(await readEndpointFile(bad)).toBeUndefined();
    await writeFile(bad, 'not json');
    expect(await readEndpointFile(bad)).toBeUndefined();
  });

  it('lists newest first and skips junk', async () => {
    await writeEndpointFile(info('/w/old', { writtenAt: 1 }), home);
    await writeEndpointFile(info('/w/new', { writtenAt: 9 }), home);
    await writeFile(path.join(path.dirname(endpointFilePath('/x', home)), 'junk.json'), 'zzz');
    expect((await listEndpoints(home)).map((e) => e.workspace)).toEqual(['/w/new', '/w/old']);
    expect(await listEndpoints(path.join(home, 'absent'))).toEqual([]);
  });

  it('removes only files owned by the given pid', async () => {
    const file = await writeEndpointFile(info('/w/x', { pid: 111 }), home);
    await removeEndpointFile('/w/x', { home, pid: 222 });
    expect(await readEndpointFile(file)).toBeDefined();
    await removeEndpointFile('/w/x', { home, pid: 111 });
    expect(await readEndpointFile(file)).toBeUndefined();
    await removeEndpointFile('/w/x', { home }); // missing: no throw
  });

  it('ensureEndpointFile re-claims a removed or dead file but never steals a live window (regression)', async () => {
    const mine = info('/ws', { port: 1111, token: 'mine' });
    // Window B (other live pid) overwrote the file, then closed and removed it.
    await writeEndpointFile(info('/ws', { pid: 424242, port: 2222, token: 'theirs' }), home);
    expect(await ensureEndpointFile(mine, { home, isAlive: () => true })).toBe(false);
    expect((await readEndpointFile(endpointFilePath('/ws', home)))?.token).toBe('theirs');
    await removeEndpointFile('/ws', { home, pid: 424242 });
    expect(await ensureEndpointFile(mine, { home, isAlive: () => true })).toBe(true);
    expect((await readEndpointFile(endpointFilePath('/ws', home)))?.token).toBe('mine');
    // Already ours: no rewrite.
    expect(await ensureEndpointFile(mine, { home })).toBe(false);
    // Owned by a dead pid: re-claimed.
    await writeEndpointFile(info('/ws', { pid: 424242, token: 'dead' }), home);
    expect(await ensureEndpointFile(mine, { home, isAlive: () => false })).toBe(true);
    expect((await readEndpointFile(endpointFilePath('/ws', home)))?.token).toBe('mine');
  });
  it('checks pid liveness', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe('installShim', () => {
  it('copies to the stable path and is idempotent', async () => {
    const src = path.join(home, 'src.js');
    await writeFile(src, 'console.log(1)');
    const target = await installShim(src, home);
    expect(target).toBe(path.join(home, '.diby', 'bin', 'mcp-shim.js'));
    expect(await readFile(target, 'utf8')).toBe('console.log(1)');
    const m1 = (await stat(target)).mtimeMs;
    await installShim(src, home);
    expect((await stat(target)).mtimeMs).toBe(m1);
    await writeFile(src, 'console.log(2)');
    await installShim(src, home);
    expect(await readFile(target, 'utf8')).toBe('console.log(2)');
    await mkdir(path.dirname(target), { recursive: true });
  });
});
