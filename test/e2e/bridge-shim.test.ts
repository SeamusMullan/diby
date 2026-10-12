/**
 * End-to-end smoke test without VS Code: real bridge (fake handlers) <-> endpoint file on disk <->
 * the BUILT `dist/mcp-shim.js` spawned as a child process <-> MCP SDK Client over stdio.
 *
 * Skipped when `dist/mcp-shim.js` has not been built (`npm run build`).
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { workspaceKey } from '../../src/bridge/endpointFile';
import { startBridge } from '../../src/bridge/server';
import { NOT_RUNNING_MESSAGE } from '../../src/constants';
import type {
  BridgeServer,
  DelegateRequest,
  EndpointInfo,
  Preferences,
  ToolCallContext,
  ToolHandlers,
  WaitResponse,
} from '../../src/types';

const SHIM = path.resolve(__dirname, '../../dist/mcp-shim.js');
const built = existsSync(SHIM);

const HUMAN_CODE = 'def parse_duration(text: str) -> int:\n    return  42   # weird spacing kept verbatim\n';

interface Call {
  tool: string;
  req: unknown;
  ctx: ToolCallContext;
}

function fakeHandlers(calls: Call[]): ToolHandlers {
  return {
    async delegate(req, ctx) {
      calls.push({ tool: 'delegate', req, ctx });
      return { id: 'e2e-1', status: 'pending', message: 'Offered to the human.' };
    },
    async wait(req, ctx) {
      calls.push({ tool: 'wait', req, ctx });
      const res: WaitResponse = {
        id: req.id,
        status: 'passed',
        code: HUMAN_CODE,
        codeRange: { startLine: 4, endLine: 5 },
        testsPassed: 3,
        testsTotal: 3,
        message: 'Integrate verbatim.',
      };
      return res;
    },
    async cancel(req, ctx) {
      calls.push({ tool: 'cancel', req, ctx });
      return { id: req.id, status: 'cancelled', message: 'Cancelled.' };
    },
    async preferences(req, ctx) {
      calls.push({ tool: 'preferences', req, ctx });
      const prefs: Preferences = {
        mode: 'learn',
        focusConcepts: ['parsing'],
        avoidConcepts: [],
        maxDifficulty: 4,
        snoozed: false,
        busy: false,
        guidance: 'Learn mode.',
      };
      return prefs;
    },
  };
}

const delegateArgs: DelegateRequest = {
  file: 'textkit/duration.py',
  range: { startLine: 4, endLine: 10 },
  symbol: 'parse_duration',
  signature: 'def parse_duration(text: str) -> int:',
  spec: 'Convert `1h30m` into seconds.',
  testCommand: 'pytest -q tests/test_duration.py',
  testFiles: ['tests/test_duration.py'],
  language: 'python',
  concepts: ['parsing'],
  difficulty: 2,
};

/** Child env: inherit PATH etc., but never the caller's own Diby locator overrides. */
function childEnv(endpointDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('DIBY_')) env[k] = v;
  }
  env.DIBY_ENDPOINT_DIR = endpointDir;
  return env;
}

async function spawnShim(cwd: string, endpointDir: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SHIM],
    cwd,
    env: childEnv(endpointDir),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'diby-e2e', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

const textOf = (r: unknown): string => (r as { content: { type: string; text: string }[] }).content[0]!.text;

describe.skipIf(!built)('e2e: bridge <-> dist/mcp-shim.js over stdio', () => {
  let tmp: string;
  let workspace: string;
  let endpointDir: string;
  let bridge: BridgeServer;
  const calls: Call[] = [];
  const clients: Client[] = [];

  beforeAll(async () => {
    tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'diby-e2e-')));
    workspace = path.join(tmp, 'project');
    endpointDir = path.join(tmp, 'endpoints');
    mkdirSync(path.join(workspace, 'textkit'), { recursive: true });
    mkdirSync(endpointDir, { recursive: true });

    bridge = await startBridge(fakeHandlers(calls));
    const info: EndpointInfo = {
      version: 1,
      port: bridge.port,
      token: bridge.token,
      pid: process.pid,
      workspace,
      writtenAt: Date.now(),
      extensionVersion: 'e2e',
    };
    // Written by hand (not via writeEndpointFile) so the shim's hashing is checked independently.
    writeFileSync(path.join(endpointDir, `${workspaceKey(workspace)}.json`), JSON.stringify(info), { mode: 0o600 });
  });

  afterAll(async () => {
    await Promise.allSettled(clients.map((c) => c.close()));
    await bridge?.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('initializes and lists the four diby tools', async () => {
    const client = await spawnShim(path.join(workspace, 'textkit'), endpointDir);
    clients.push(client);
    expect(client.getServerVersion()?.name).toBe('diby');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['diby_cancel', 'diby_delegate', 'diby_preferences', 'diby_wait']);
  });

  it('forwards diby_preferences and diby_delegate (with the agent cwd) to the bridge', async () => {
    const agentCwd = path.join(workspace, 'textkit');
    const client = await spawnShim(agentCwd, endpointDir);
    clients.push(client);

    const prefs = await client.callTool({ name: 'diby_preferences', arguments: {} });
    expect(prefs.isError).toBeFalsy();
    expect(JSON.parse(textOf(prefs))).toMatchObject({ mode: 'learn', maxDifficulty: 4 });

    const del = await client.callTool({ name: 'diby_delegate', arguments: { ...delegateArgs } });
    expect(del.isError).toBeFalsy();
    expect(JSON.parse(textOf(del))).toEqual({ id: 'e2e-1', status: 'pending', message: 'Offered to the human.' });

    const delegateCall = calls.find((c) => c.tool === 'delegate');
    expect(delegateCall?.req).toMatchObject({ symbol: 'parse_duration', range: { startLine: 4, endLine: 10 } });
    expect(delegateCall?.ctx.cwd).toBe(agentCwd);
  });

  it('returns the human code from diby_wait byte-for-byte and clamps timeoutSec', async () => {
    const client = await spawnShim(workspace, endpointDir);
    clients.push(client);
    const res = await client.callTool({ name: 'diby_wait', arguments: { id: 'e2e-1', timeoutSec: 45 } });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(textOf(res)) as WaitResponse;
    expect(body.status).toBe('passed');
    expect(body.code).toBe(HUMAN_CODE);
    expect(calls.find((c) => c.tool === 'wait')?.req).toEqual({ id: 'e2e-1', timeoutSec: 45 });
  });

  it('rejects an invalid delegate before it reaches the bridge handlers', async () => {
    const client = await spawnShim(workspace, endpointDir);
    clients.push(client);
    const before = calls.length;
    const res = await client.callTool({ name: 'diby_delegate', arguments: { ...delegateArgs, difficulty: 9 } });
    expect(res.isError).toBe(true);
    expect(calls.length).toBe(before);
  });

  it('reports "not running" when no endpoint file is live', async () => {
    const emptyDir = path.join(tmp, 'no-endpoints');
    mkdirSync(emptyDir, { recursive: true });
    const client = await spawnShim(workspace, emptyDir);
    clients.push(client);
    const res = await client.callTool({ name: 'diby_preferences', arguments: {} });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(NOT_RUNNING_MESSAGE);
  });
});
