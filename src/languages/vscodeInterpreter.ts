/**
 * MODULE languages — VS Code-facing Python interpreter lookup (thin; the only vscode import in this module).
 * Order: ms-python.python extension API (if installed; never a hard dependency) ->
 * `python.defaultInterpreterPath` setting -> undefined (adapter then uses `python3`).
 */
import * as vscode from 'vscode';

interface PythonApi {
  environments?: {
    getActiveEnvironmentPath(resource?: vscode.Uri): { path: string } | undefined;
    resolveEnvironment(env: unknown): Promise<{ executable?: { uri?: vscode.Uri; fsPath?: string } } | undefined>;
  };
}

export async function resolvePythonInterpreter(workspaceFolder: string): Promise<string | undefined> {
  const uri = vscode.Uri.file(workspaceFolder);
  try {
    const ext = vscode.extensions.getExtension<PythonApi>('ms-python.python');
    if (ext) {
      const api = ext.isActive ? ext.exports : await ext.activate();
      const envs = (api ?? ext.exports)?.environments;
      const active = envs?.getActiveEnvironmentPath(uri);
      if (envs && active) {
        const resolved = await envs.resolveEnvironment(active);
        const p = resolved?.executable?.uri?.fsPath ?? resolved?.executable?.fsPath;
        if (p) return p;
        if (active.path && active.path !== 'python') return active.path;
      }
    }
  } catch {
    /* fall through to settings */
  }
  const configured = vscode.workspace.getConfiguration('python', uri).get<string>('defaultInterpreterPath');
  if (configured && configured.trim() !== '' && configured !== 'python') {
    return configured.replace('${workspaceFolder}', workspaceFolder);
  }
  return undefined;
}
