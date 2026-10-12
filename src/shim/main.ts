/**
 * MODULE transport — entry point of dist/mcp-shim.js, a standalone stdio MCP server.
 * Runs under plain `node` (or Electron-as-node). Must NOT import vscode.
 * NEVER write to stdout except via the MCP transport (stdout is the protocol); log to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DIBY_VERSION, MCP_SERVER_NAME } from '../constants';
import { callBridge } from './client';
import { locateEndpoint } from './locate';
import { registerDibyTools } from './tools';

async function main(): Promise<void> {
  const cwd = process.cwd();
  const server = new McpServer({ name: MCP_SERVER_NAME, version: DIBY_VERSION });
  registerDibyTools(server, { cwd, locate: () => locateEndpoint(cwd), call: callBridge });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`diby mcp-shim ${DIBY_VERSION} ready (cwd: ${cwd})\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`diby mcp-shim fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
