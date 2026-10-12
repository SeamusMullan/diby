/**
 * MODULE transport — loopback HTTP JSON bridge. Pure Node (no vscode).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { BRIDGE_HOST, CWD_HEADER, DIBY_VERSION, MAX_BODY_BYTES, TOOL_NAMES } from '../constants';
import { TOOL_INPUT_SCHEMAS } from '../schemas';
import type { BridgeErrorBody, BridgeServer, ToolCallContext, ToolHandlers, ToolName } from '../types';

export interface StartBridgeOptions {
  /** 0 or undefined = random free port. */
  port?: number;
  /** Bearer token; random 32-byte hex if omitted. */
  token?: string;
  log?: (message: string) => void;
}

class BodyTooLargeError extends Error {}

function tokensMatch(expected: string, header: string | undefined): boolean {
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(m[1]!);
  // Compare fixed-size digests-by-padding so length differences don't short-circuit unsafely.
  const len = Math.max(a.length, b.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  a.copy(pa);
  b.copy(pb);
  return timingSafeEqual(pa, pb) && a.length === b.length;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, body: BridgeErrorBody): void {
  sendJson(res, status, body);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLargeError());
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCwd(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function isToolName(s: string): s is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(s);
}

/** Start the loopback bridge. Resolves once listening. */
export function startBridge(handlers: ToolHandlers, opts: StartBridgeOptions = {}): Promise<BridgeServer> {
  const token = opts.token ?? randomBytes(32).toString('hex');
  const log = opts.log ?? (() => undefined);

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log(`bridge internal error: ${String(err)}`);
      sendError(res, 500, { error: 'internal', message: err instanceof Error ? err.message : String(err) });
    });
  });
  // Long-polls (up to 45 s) must never be cut off by node's default timeouts.
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;
  server.timeout = 0;
  server.keepAliveTimeout = 5_000;

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!tokensMatch(token, req.headers.authorization)) {
      sendError(res, 401, { error: 'unauthorized', message: 'Missing or invalid bearer token.' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, name: 'diby', version: DIBY_VERSION, pid: process.pid });
      return;
    }

    const m = /^\/tool\/([a-z]+)$/.exec(url.pathname);
    if (!m || !isToolName(m[1]!)) {
      sendError(res, 404, { error: 'not_found', message: `Unknown route ${url.pathname}.` });
      return;
    }
    if (req.method !== 'POST') {
      sendError(res, 404, { error: 'not_found', message: 'Tool routes accept POST only.' });
      return;
    }
    const name = m[1];

    let raw: string;
    try {
      raw = await readBody(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        sendError(res, 413, { error: 'invalid_request', message: `Request body exceeds ${MAX_BODY_BYTES} bytes.` });
        return;
      }
      throw err;
    }

    let json: unknown = {};
    if (raw.trim().length > 0) {
      try {
        json = JSON.parse(raw);
      } catch {
        sendError(res, 400, { error: 'invalid_request', message: 'Body is not valid JSON.' });
        return;
      }
    }

    const parsed = TOOL_INPUT_SCHEMAS[name].safeParse(json);
    if (!parsed.success) {
      sendError(res, 400, {
        error: 'invalid_request',
        message: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
        issues: parsed.error.issues,
      });
      return;
    }

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });
    const ctx: ToolCallContext = { cwd: parseCwd(req.headers[CWD_HEADER]), signal: ac.signal };

    // The handler map is keyed by name; each handler takes its own validated request type.
    const handler = handlers[name] as (r: unknown, c: ToolCallContext) => Promise<unknown>;
    const result = await handler.call(handlers, parsed.data, ctx);
    sendJson(res, 200, result ?? {});
  }

  return new Promise<BridgeServer>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, BRIDGE_HOST, () => {
      server.off('error', reject);
      const { port } = server.address() as AddressInfo;
      log(`bridge listening on ${BRIDGE_HOST}:${port}`);
      resolve({
        port,
        token,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
