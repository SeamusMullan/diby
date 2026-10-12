/**
 * MODULE connect — registers the shim with VS Code's MCP support (Copilot agent mode). Thin vscode wrapper.
 */
import * as vscode from 'vscode';
import { DIBY_VERSION, MCP_PROVIDER_ID } from '../constants';

/**
 * Registers a stdio MCP server definition that runs the bundled shim under VS Code's own Node.
 * `bundledShimPath` = context.asAbsolutePath('dist/mcp-shim.js'). Returns a no-op disposable when the
 * running VS Code lacks the MCP provider API.
 */
export function registerCopilotMcpProvider(context: vscode.ExtensionContext, bundledShimPath: string): vscode.Disposable {
  const lm = (vscode as { lm?: Partial<typeof vscode.lm> }).lm;
  if (typeof lm?.registerMcpServerDefinitionProvider !== 'function') return new vscode.Disposable(() => undefined);

  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.McpServerDefinitionProvider = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions() {
      const folder = vscode.workspace.workspaceFolders?.[0];
      const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1' };
      if (folder) env.DIBY_WORKSPACE = folder.uri.fsPath;
      const def = new vscode.McpStdioServerDefinition('Diby', process.execPath, [bundledShimPath], env, DIBY_VERSION);
      if (folder) def.cwd = folder.uri;
      return [def];
    },
  };
  const registration = lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, provider);
  const folders = vscode.workspace.onDidChangeWorkspaceFolders(() => changed.fire());
  const disposable = vscode.Disposable.from(registration, folders, changed);
  context.subscriptions.push(disposable);
  return disposable;
}
