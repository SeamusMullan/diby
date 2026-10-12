import { afterEach, describe, expect, it } from 'vitest';
import { startBridge } from '../../src/bridge/server';
import type { BridgeServer } from '../../src/types';
import { fakeHandlers, validDelegate, type Recorded } from './helpers';

let bridge: BridgeServer | undefined;
afterEach(async () => {
  await bridge?.close();
  bridge = undefined;
});

const url = (p: string) => `http://127.0.0.1:${bridge!.port}${p}`;
const auth = () => ({ Authorization: `Bearer ${bridge!.token}`, 'Content-Type': 'application/json' });

describe('bridge server', () => {
  it('rejects missing and wrong tokens', async () => {
    bridge = await startBridge(fakeHandlers());
    expect((await fetch(url('/health'))).status).toBe(401);
    const bad = await fetch(url('/health'), { headers: { Authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
    expect(((await bad.json()) as { error: string }).error).toBe('unauthorized');
  });

  it('serves /health with a valid token', async () => {
    bridge = await startBridge(fakeHandlers());
    const res = await fetch(url('/health'), { headers: auth() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: 'diby', pid: process.pid });
  });

  it('routes delegate with validated, defaulted input and cwd header', async () => {
    const calls: Recorded[] = [];
    bridge = await startBridge(fakeHandlers(calls));
    const res = await fetch(url('/tool/delegate'), {
      method: 'POST',
      headers: { ...auth(), 'x-diby-cwd': encodeURIComponent('/tmp/my project') },
      body: JSON.stringify(validDelegate),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'c1', status: 'pending', message: 'ok' });
    expect(calls[0]!.ctx.cwd).toBe('/tmp/my project');
    expect((calls[0]!.req as { concepts: string[] }).concepts).toEqual([]);
  });

  it('treats an empty body as {} for preferences and applies wait defaults', async () => {
    const calls: Recorded[] = [];
    bridge = await startBridge(fakeHandlers(calls));
    expect((await fetch(url('/tool/preferences'), { method: 'POST', headers: auth() })).status).toBe(200);
    await fetch(url('/tool/wait'), { method: 'POST', headers: auth(), body: JSON.stringify({ id: 'c1' }) });
    expect(calls[1]!.req).toEqual({ id: 'c1', timeoutSec: 30 });
  });

  it('returns 400 with issues for invalid input and malformed JSON', async () => {
    bridge = await startBridge(fakeHandlers());
    const res = await fetch(url('/tool/wait'), { method: 'POST', headers: auth(), body: JSON.stringify({ timeoutSec: 999 }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe('invalid_request');
    expect(body.issues.length).toBeGreaterThan(0);
    const bad = await fetch(url('/tool/wait'), { method: 'POST', headers: auth(), body: '{oops' });
    expect(bad.status).toBe(400);
  });

  it('returns 404 for unknown routes and non-POST tool calls', async () => {
    bridge = await startBridge(fakeHandlers());
    expect((await fetch(url('/tool/explode'), { method: 'POST', headers: auth() })).status).toBe(404);
    expect((await fetch(url('/nope'), { headers: auth() })).status).toBe(404);
    expect((await fetch(url('/tool/wait'), { headers: auth() })).status).toBe(404);
  });

  it('returns 413 for oversized bodies', async () => {
    bridge = await startBridge(fakeHandlers());
    const res = await fetch(url('/tool/cancel'), {
      method: 'POST',
      headers: auth(),
      body: JSON.stringify({ id: 'x'.repeat(1_100_000) }),
    });
    expect(res.status).toBe(413);
  });

  it('returns 500 when a handler throws', async () => {
    const h = fakeHandlers();
    h.preferences = async () => {
      throw new Error('boom');
    };
    bridge = await startBridge(h);
    const res = await fetch(url('/tool/preferences'), { method: 'POST', headers: auth(), body: '{}' });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { message: string }).message).toBe('boom');
  });

  it('aborts the handler signal when the client disconnects', async () => {
    let aborted!: () => void;
    const abortedP = new Promise<void>((r) => (aborted = r));
    const h = fakeHandlers();
    h.wait = (_req, ctx) =>
      new Promise((resolve) => {
        ctx.signal!.addEventListener('abort', () => {
          aborted();
          resolve({ id: 'c1', status: 'active' } as never);
        });
      });
    bridge = await startBridge(h);
    const ac = new AbortController();
    const p = fetch(url('/tool/wait'), { method: 'POST', headers: auth(), body: JSON.stringify({ id: 'c1' }), signal: ac.signal });
    p.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    await abortedP;
  });

  it('honours a custom token and binds loopback', async () => {
    bridge = await startBridge(fakeHandlers(), { token: 'secret' });
    expect(bridge.token).toBe('secret');
    expect(bridge.port).toBeGreaterThan(0);
    const res = await fetch(url('/health'), { headers: { Authorization: 'Bearer secret' } });
    expect(res.status).toBe(200);
  });
});
