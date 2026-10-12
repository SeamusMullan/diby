/**
 * MODULE transport — registers the four Diby MCP tools on an McpServer and forwards them to the bridge.
 * Pure Node (no vscode).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MCP_TOOL_NAMES, NOT_RUNNING_MESSAGE, TOOL_NAMES, WAIT_MAX_SEC } from '../constants';
import { TOOL_DESCRIPTIONS, TOOL_INPUT_SCHEMAS } from '../schemas';
import type { EndpointInfo, ToolName } from '../types';
import { BridgeRequestError, BridgeUnavailableError, type callBridge } from './client';

export interface DibyToolDeps {
  /** The agent's working directory (the shim's cwd). */
  cwd: string;
  /** Locates the endpoint; called on EVERY tool call so VS Code restarts are survived. */
  locate: () => Promise<EndpointInfo | undefined>;
  call: typeof callBridge;
}

interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

const text = (t: string, isError = false): ToolResult => ({
  content: [{ type: 'text', text: t }],
  ...(isError ? { isError: true } : {}),
});

/** Forward one tool call; maps transport failures to MCP error results (never throws except on abort). */
export async function forwardToolCall(
  deps: DibyToolDeps,
  tool: ToolName,
  args: unknown,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const endpoint = await deps.locate();
  if (!endpoint) return text(NOT_RUNNING_MESSAGE, true);

  let payload = args;
  if (tool === 'wait' && typeof args === 'object' && args !== null) {
    const a = args as { timeoutSec?: number };
    if (typeof a.timeoutSec === 'number') payload = { ...a, timeoutSec: Math.min(a.timeoutSec, WAIT_MAX_SEC) };
  }

  try {
    const result = await deps.call(endpoint, tool, payload, { cwd: deps.cwd, signal });
    return text(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof BridgeUnavailableError) return text(NOT_RUNNING_MESSAGE, true);
    // 401 means the endpoint file is stale (e.g. its pid was reused by another bridge): treat as not running.
    if (err instanceof BridgeRequestError && err.status === 401) {
      return text(`${NOT_RUNNING_MESSAGE} (stale Diby endpoint: HTTP 401)`, true);
    }
    if (err instanceof BridgeRequestError) return text(`Diby error (${err.status}): ${err.message}`, true);
    if (signal?.aborted) throw err;
    return text(`Diby error: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

/** Register diby_delegate, diby_wait, diby_cancel and diby_preferences. */
export function registerDibyTools(server: McpServer, deps: DibyToolDeps): void {
  for (const tool of TOOL_NAMES) {
    server.registerTool(
      MCP_TOOL_NAMES[tool],
      {
        description: TOOL_DESCRIPTIONS[tool],
        inputSchema: TOOL_INPUT_SCHEMAS[tool].shape,
      },
      (async (args: unknown, extra: { signal?: AbortSignal }) =>
        forwardToolCall(deps, tool, args, extra?.signal)) as never,
    );
  }
}
