/**
 * Shared constants. Owned by the architect; implementers import, never edit.
 * No `vscode` import here.
 */
import type { ToolName } from './types';

/** Extension version, injected at build time by esbuild/vitest `define`. */
export const DIBY_VERSION: string = __DIBY_VERSION__;

/** Bridge binds to loopback only. */
export const BRIDGE_HOST = '127.0.0.1';

/** Header carrying the agent's cwd from the shim to the bridge. */
export const CWD_HEADER = 'x-diby-cwd';

/** Directory (under the user's home) for runtime files. */
export const DIBY_HOME_DIRNAME = '.diby';
/** Endpoint files live in `~/.diby/endpoints/`. */
export const ENDPOINTS_SUBDIR = 'endpoints';
/** Stable copy of the shim: `~/.diby/bin/mcp-shim.js` (survives extension upgrades). */
export const SHIM_BIN_SUBDIR = 'bin';
export const SHIM_FILENAME = 'mcp-shim.js';

/** Long-poll limits for `diby_wait`. */
export const WAIT_DEFAULT_SEC = 30;
export const WAIT_MAX_SEC = 45;
/** Shim HTTP timeout; must exceed WAIT_MAX_SEC. */
export const SHIM_HTTP_TIMEOUT_MS = 55_000;

/** How long the Accept/Skip/Snooze offer stays open before it counts as `skip`. */
export const OFFER_TIMEOUT_MS = 2 * 60_000;
/** How long the optional reflection input waits. */
export const REFLECTION_TIMEOUT_MS = 2 * 60_000;

/** Bridge request body limit. */
export const MAX_BODY_BYTES = 1_000_000;
/** Per-stream cap on captured test output. */
export const MAX_OUTPUT_BYTES = 200_000;
/** Maximum persisted history entries. */
export const MAX_HISTORY_ENTRIES = 500;

/** Marker the agent puts in a Python stub: `raise NotImplementedError("DIBY: ...")`. */
export const STUB_MARKER = 'DIBY';

/** MCP server name (used in .mcp.json, ~/.codex/config.toml and the Copilot provider id). */
export const MCP_SERVER_NAME = 'diby';
/** Must match `contributes.mcpServerDefinitionProviders[0].id` in package.json. */
export const MCP_PROVIDER_ID = 'diby';

/** Bridge tool name -> MCP tool name. */
export const MCP_TOOL_NAMES: Readonly<Record<ToolName, string>> = {
  delegate: 'diby_delegate',
  wait: 'diby_wait',
  cancel: 'diby_cancel',
  preferences: 'diby_preferences',
};
export const TOOL_NAMES: readonly ToolName[] = ['delegate', 'wait', 'cancel', 'preferences'];

/** Error text the shim returns when no VS Code instance is reachable. */
export const NOT_RUNNING_MESSAGE =
  'Diby is not running in VS Code — implement the function yourself.';

/** AGENTS.md section markers (idempotent upsert). */
export const AGENTS_MD_START = '<!-- diby:start -->';
export const AGENTS_MD_END = '<!-- diby:end -->';
/** Line ensured in CLAUDE.md so Claude Code reads AGENTS.md. */
export const CLAUDE_MD_IMPORT = '@AGENTS.md';

/** Codex per-tool timeout written to config.toml. */
export const CODEX_TOOL_TIMEOUT_SEC = 60;

/** VS Code context key set while a challenge is pending/active. */
export const CONTEXT_CHALLENGE_ACTIVE = 'diby.challengeActive';

/** Command ids (must match package.json). */
export const COMMANDS = {
  connectAgents: 'diby.connectAgents',
  runTests: 'diby.runTests',
  giveUp: 'diby.giveUp',
  showPanel: 'diby.showPanel',
  snooze: 'diby.snooze',
  setMode: 'diby.setMode',
  startDemoChallenge: 'diby.startDemoChallenge',
} as const;

/** globalState key for history. */
export const HISTORY_STATE_KEY = 'diby.history.v1';
