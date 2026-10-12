import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { endpointFilePath, writeEndpointFile } from '../../src/bridge/endpointFile';
import { locateEndpoint } from '../../src/shim/locate';
import type { EndpointInfo } from '../../src/types';

let home: string;
let root: string;
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'diby-home-'));
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'diby-ws-')));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

const ep = (workspace: string, over: Partial<EndpointInfo> = {}): EndpointInfo => ({
  version: 1,
  port: 1000,
  token: 't',
  pid: 100,
  workspace,
  writtenAt: 1,
  extensionVersion: '',
  ...over,
});
const alive = () => true;

describe('locateEndpoint', () => {
  it('picks the longest (deepest) workspace prefix', async () => {
    const inner = path.join(root, 'mono', 'pkg');
    await mkdir(path.join(inner, 'src'), { recursive: true });
    await writeEndpointFile(ep(root, { port: 1 }), home);
    await writeEndpointFile(ep(inner, { port: 2 }), home);
    const hit = await locateEndpoint(path.join(inner, 'src'), { home, env: {}, isAlive: alive });
    expect(hit?.port).toBe(2);
    const outer = await locateEndpoint(path.join(root, 'mono'), { home, env: {}, isAlive: alive });
    expect(outer?.port).toBe(1);
  });

  it('skips endpoints whose pid is dead', async () => {
    await writeEndpointFile(ep(root, { pid: 7 }), home);
    expect(await locateEndpoint(root, { home, env: {}, isAlive: () => false })).toBeUndefined();
  });

  it('falls back to the newest live endpoint', async () => {
    await writeEndpointFile(ep('/elsewhere/a', { port: 1, writtenAt: 1 }), home);
    await writeEndpointFile(ep('/elsewhere/b', { port: 2, writtenAt: 5 }), home);
    await writeEndpointFile(ep('/elsewhere/c', { port: 3, writtenAt: 9, pid: 666 }), home);
    const hit = await locateEndpoint(root, { home, env: {}, isAlive: (pid) => pid !== 666 });
    expect(hit?.port).toBe(2);
  });

  it('honours DIBY_WORKSPACE and DIBY_ENDPOINT_FILE first', async () => {
    await writeEndpointFile(ep(root, { port: 1 }), home);
    await writeEndpointFile(ep('/other', { port: 2, writtenAt: 99 }), home);
    const byWs = await locateEndpoint(root, { home, env: { DIBY_WORKSPACE: '/other' }, isAlive: alive });
    expect(byWs?.port).toBe(2);
    const byFile = await locateEndpoint(root, {
      home,
      env: { DIBY_ENDPOINT_FILE: endpointFilePath('/other', home), DIBY_WORKSPACE: root },
      isAlive: alive,
    });
    expect(byFile?.port).toBe(2);
  });

  it('resolves via realpath of a symlinked cwd', async () => {
    const { symlink } = await import('node:fs/promises');
    const link = path.join(os.tmpdir(), `diby-link-${process.pid}-${Date.now()}`);
    await symlink(root, link);
    try {
      await writeEndpointFile(ep(root, { port: 5 }), home);
      const hit = await locateEndpoint(link, { home, env: {}, isAlive: alive });
      expect(hit?.port).toBe(5);
    } finally {
      await rm(link, { force: true });
    }
  });

  it('returns undefined when nothing exists', async () => {
    expect(await locateEndpoint(root, { home, env: {}, isAlive: alive })).toBeUndefined();
  });
});
