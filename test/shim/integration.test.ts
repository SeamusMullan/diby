import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startBridge } from '../../src/bridge/server';
import { NOT_RUNNING_MESSAGE } from '../../src/constants';
import { BridgeRequestError, BridgeUnavailableError, callBridge } from '../../src/shim/client';
import { registerDibyTools } from '../../src/shim/tools';
import type { BridgeServer, EndpointInfo } from '../../src/types';
import { fakeHandlers, validDelegate, type Recorded } from '../bridge/helpers';

let bridge: BridgeServer | undefined;
let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  await bridge?.close();
  bridge = client = undefined;
});

const endpointFor = (b: BridgeServer, token = b.token): EndpointInfo => ({
  version: 1,
  port: b.port,
  token,
  pid: process.pid,
  workspace: '/w',
  writtenAt: 1,
  extensionVersion: '',
});

async function connect(locate: () => Promise<EndpointInfo | undefined>): Promise<Client> {
  const server = new McpServer({ name: 'diby', version: '0.0.0' });
  registerDibyTools(server, { cwd: '/agent cwd', locate, call: callBridge });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(ct);
  return client;
}

const textOf = (r: unknown): string => (r as { content: { text: string }[] }).content[0]!.text;

describe('callBridge', () => {
  it('works with a caller signal on Node without AbortSignal.any (node18 target, regression)', async () => {
    bridge = await startBridge(fakeHandlers());
    const original = (AbortSignal as { any?: unknown }).any;
    (AbortSignal as { any?: unknown }).any = undefined;
    try {
      const ac = new AbortController();
      const out = await callBridge(endpointFor(bridge), 'preferences', {}, { cwd: '/', signal: ac.signal });
      expect(out).toBeDefined();
      ac.abort();
      await expect(callBridge(endpointFor(bridge), 'preferences', {}, { cwd: '/', signal: ac.signal })).rejects.toThrow();
    } finally {
      (AbortSignal as { any?: unknown }).any = original;
    }
  });

  it('forwards args and cwd, returns JSON', async () => {
    const calls: Recorded[] = [];
    bridge = await startBridge(fakeHandlers(calls));
    const out = await callBridge(endpointFor(bridge), 'delegate', validDelegate, { cwd: '/a b' });
    expect(out).toMatchObject({ id: 'c1', status: 'pending' });
    expect(calls[0]!.ctx.cwd).toBe('/a b');
  });

  it('throws BridgeRequestError on 401 and 400', async () => {
    bridge = await startBridge(fakeHandlers());
    await expect(callBridge(endpointFor(bridge, 'bad'), 'preferences', {}, { cwd: '/' })).rejects.toBeInstanceOf(BridgeRequestError);
    await expect(callBridge(endpointFor(bridge), 'wait', {}, { cwd: '/' })).rejects.toMatchObject({ status: 400 });
  });

  it('throws BridgeUnavailableError when nothing listens', async () => {
    const b = await startBridge(fakeHandlers());
    const ep = endpointFor(b);
    await b.close();
    await expect(callBridge(ep, 'preferences', {}, { cwd: '/' })).rejects.toBeInstanceOf(BridgeUnavailableError);
  });
});

describe('MCP shim over in-memory transport', () => {
  it('lists the four diby tools with schemas and descriptions', async () => {
    const c = await connect(async () => undefined);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['diby_cancel', 'diby_delegate', 'diby_preferences', 'diby_wait']);
    const del = tools.find((t) => t.name === 'diby_delegate')!;
    expect(del.description).toContain('NotImplementedError');
    expect(Object.keys((del.inputSchema as { properties: object }).properties)).toContain('testCommand');
  });

  it('forwards a delegate call through the real bridge', async () => {
    const calls: Recorded[] = [];
    bridge = await startBridge(fakeHandlers(calls));
    const ep = endpointFor(bridge);
    const c = await connect(async () => ep);
    const res = await c.callTool({ name: 'diby_delegate', arguments: validDelegate });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(textOf(res))).toMatchObject({ id: 'c1', status: 'pending' });
    expect(calls[0]!.ctx.cwd).toBe('/agent cwd');
  });

  it('forwards wait and returns the verbatim code', async () => {
    bridge = await startBridge(fakeHandlers());
    const ep = endpointFor(bridge);
    const c = await connect(async () => ep);
    const res = await c.callTool({ name: 'diby_wait', arguments: { id: 'c1', timeoutSec: 1 } });
    expect(JSON.parse(textOf(res))).toMatchObject({ status: 'passed', code: 'x = 1' });
  });

  it('returns the not-running error when no endpoint is found', async () => {
    const c = await connect(async () => undefined);
    const res = await c.callTool({ name: 'diby_preferences', arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(NOT_RUNNING_MESSAGE);
  });

  it('returns the not-running error when the bridge is gone, and re-locates each call', async () => {
    const dead = await startBridge(fakeHandlers());
    const deadEp = endpointFor(dead);
    await dead.close();
    bridge = await startBridge(fakeHandlers());
    const liveEp = endpointFor(bridge);
    let ep = deadEp;
    const c = await connect(async () => ep);
    const first = await c.callTool({ name: 'diby_preferences', arguments: {} });
    expect(first.isError).toBe(true);
    expect(textOf(first)).toBe(NOT_RUNNING_MESSAGE);
    ep = liveEp;
    const second = await c.callTool({ name: 'diby_preferences', arguments: {} });
    expect(second.isError).toBeFalsy();
  });

  it('surfaces bridge request errors as tool errors', async () => {
    bridge = await startBridge(fakeHandlers());
    const ep = endpointFor(bridge, 'wrong-token');
    const c = await connect(async () => ep);
    const res = await c.callTool({ name: 'diby_preferences', arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('401');
  });
});
