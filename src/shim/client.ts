/**
 * MODULE transport — shim-side HTTP client for the extension bridge. Pure Node (no vscode).
 */
import { BRIDGE_HOST, CWD_HEADER, SHIM_HTTP_TIMEOUT_MS } from '../constants';
import type { BridgeErrorBody, EndpointInfo, ToolName } from '../types';

/** The bridge could not be reached (connection refused/reset, timeout). */
export class BridgeUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BridgeUnavailableError';
  }
}

/** The bridge answered with a non-2xx status. */
export class BridgeRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: BridgeErrorBody | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeRequestError';
  }
}

export interface CallBridgeOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * AbortSignal.any() only exists on Node >= 20.3, but agents launch the shim with whatever `node` is on
 * PATH (the bundle targets node18). Fall back to a manual combination.
 */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const native = (AbortSignal as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === 'function') return native.call(AbortSignal, signals);
  const ac = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ac.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ac.abort(s.reason), { once: true });
  }
  return ac.signal;
}

/** POST /tool/<tool> with the endpoint's bearer token; returns the parsed JSON result. */
export async function callBridge(
  endpoint: EndpointInfo,
  tool: ToolName,
  args: unknown,
  opts: CallBridgeOptions,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? SHIM_HTTP_TIMEOUT_MS);
  const signal = opts.signal ? anySignal([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(`http://${BRIDGE_HOST}:${endpoint.port}/tool/${tool}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.token}`,
        [CWD_HEADER]: encodeURIComponent(opts.cwd),
      },
      body: JSON.stringify(args ?? {}),
      signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    const why = timeout.aborted ? 'timed out' : 'could not be reached';
    throw new BridgeUnavailableError(`Diby bridge on port ${endpoint.port} ${why}.`, { cause: err });
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const body = json as BridgeErrorBody | undefined;
    throw new BridgeRequestError(res.status, body, body?.message ?? `Diby bridge returned HTTP ${res.status}.`);
  }
  return json;
}
